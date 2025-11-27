#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import WebSocket from "ws";
import { v4 as uuidv4 } from "uuid";
import { registerPrompts } from "./prompts.js";
import figmaPrompts from "./prompts.js";
import { readFileSync, existsSync, statSync } from "fs";
import { resolve } from "path";
import sharp from "sharp";
import puppeteer from "puppeteer";

// Define TypeScript interfaces for Figma responses
interface FigmaResponse {
  id: string;
  result?: any;
  error?: string;
}

// Define interface for command progress updates
interface CommandProgressUpdate {
  type: 'command_progress';
  commandId: string;
  commandType: string;
  status: 'started' | 'in_progress' | 'completed' | 'error';
  progress: number;
  totalItems: number;
  processedItems: number;
  currentChunk?: number;
  totalChunks?: number;
  chunkSize?: number;
  message: string;
  payload?: any;
  timestamp: number;
}

// Update the getInstanceOverridesResult interface to match the plugin implementation
interface getInstanceOverridesResult {
  success: boolean;
  message: string;
  sourceInstanceId: string;
  mainComponentId: string;
  overridesCount: number;
}

interface setInstanceOverridesResult {
  success: boolean;
  message: string;
  totalCount?: number;
  results?: Array<{
    success: boolean;
    instanceId: string;
    instanceName: string;
    appliedCount?: number;
    message?: string;
  }>;
}

// Custom logging functions that write to stderr instead of stdout to avoid being captured
const logger = {
  info: (message: string) => process.stderr.write(`[INFO] ${message}\n`),
  debug: (message: string) => process.stderr.write(`[DEBUG] ${message}\n`),
  warn: (message: string) => process.stderr.write(`[WARN] ${message}\n`),
  error: (message: string) => process.stderr.write(`[ERROR] ${message}\n`),
  log: (message: string) => process.stderr.write(`[LOG] ${message}\n`)
};

// WebSocket connection and request tracking
let ws: WebSocket | null = null;
const pendingRequests = new Map<string, {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  timeout: ReturnType<typeof setTimeout>;
  lastActivity: number; // Add timestamp for last activity
}>();

// Track which channel each client is in
let currentChannel: string | null = null;

// Create MCP server
const server = new McpServer({
  name: "TalkToFigmaMCP",
  version: "1.0.0",
});

// Add command line argument parsing
const args = process.argv.slice(2);
const serverArg = args.find(arg => arg.startsWith('--server='));
const serverUrl = serverArg ? serverArg.split('=')[1] : 'localhost';
const WS_URL = serverUrl === 'localhost' ? `ws://${serverUrl}` : `wss://${serverUrl}`;

// Document Info Tool
server.tool(
  "get_document_info",
  "Get detailed information about the current Figma document",
  {},
  async () => {
    try {
      const result = await sendCommandToFigma("get_document_info");
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result)
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error getting document info: ${error instanceof Error ? error.message : String(error)
              }`,
          },
        ],
      };
    }
  }
);

// Selection Tool
server.tool(
  "get_selection",
  "Get information about the current selection in Figma",
  {},
  async () => {
    try {
      const result = await sendCommandToFigma("get_selection");
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result)
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error getting selection: ${error instanceof Error ? error.message : String(error)
              }`,
          },
        ],
      };
    }
  }
);

// Read My Design Tool
server.tool(
  "read_my_design",
  "Get detailed information about the current selection in Figma, including all node details",
  {},
  async () => {
    try {
      const result = await sendCommandToFigma("read_my_design", {});
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result)
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error getting node info: ${error instanceof Error ? error.message : String(error)
              }`,
          },
        ],
      };
    }
  }
);

// Node Info Tool
server.tool(
  "get_node_info",
  "Get detailed information about a specific node in Figma",
  {
    nodeId: z.string().describe("The ID of the node to get information about"),
  },
  async ({ nodeId }: any) => {
    try {
      const result = await sendCommandToFigma("get_node_info", { nodeId });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(filterFigmaNode(result))
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error getting node info: ${error instanceof Error ? error.message : String(error)
              }`,
          },
        ],
      };
    }
  }
);

function rgbaToHex(color: any): string {
  // skip if color is already hex
  if (color.startsWith('#')) {
    return color;
  }

  const r = Math.round(color.r * 255);
  const g = Math.round(color.g * 255);
  const b = Math.round(color.b * 255);
  const a = Math.round(color.a * 255);

  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}${a === 255 ? '' : a.toString(16).padStart(2, '0')}`;
}

function filterFigmaNode(node: any, parent?: any) {
  // Skip VECTOR type nodes
  if (node.type === "VECTOR") {
    return null;
  }

  const filtered: any = {
    id: node.id,
    name: node.name,
    type: node.type,
  };

  // Add parent information and index if parent is provided
  if (parent) {
    filtered.parent = {
      id: parent.id,
      name: parent.name,
      type: parent.type,
    };
    // Calculate index within parent
    if (parent.children) {
      const index = parent.children.findIndex((child: any) => child.id === node.id);
      if (index !== -1) {
        filtered.indexInParent = index;
      }
    }
  }

  if (node.fills && node.fills.length > 0) {
    filtered.fills = node.fills.map((fill: any) => {
      const processedFill = { ...fill };

      // Remove boundVariables and imageRef
      delete processedFill.boundVariables;
      delete processedFill.imageRef;

      // Process gradientStops if present
      if (processedFill.gradientStops) {
        processedFill.gradientStops = processedFill.gradientStops.map((stop: any) => {
          const processedStop = { ...stop };
          // Convert color to hex if present
          if (processedStop.color) {
            processedStop.color = rgbaToHex(processedStop.color);
          }
          // Remove boundVariables
          delete processedStop.boundVariables;
          return processedStop;
        });
      }

      // Convert solid fill colors to hex
      if (processedFill.color) {
        processedFill.color = rgbaToHex(processedFill.color);
      }

      return processedFill;
    });
  }

  if (node.strokes && node.strokes.length > 0) {
    filtered.strokes = node.strokes.map((stroke: any) => {
      const processedStroke = { ...stroke };
      // Remove boundVariables
      delete processedStroke.boundVariables;
      // Convert color to hex if present
      if (processedStroke.color) {
        processedStroke.color = rgbaToHex(processedStroke.color);
      }
      return processedStroke;
    });
  }

  if (node.cornerRadius !== undefined) {
    filtered.cornerRadius = node.cornerRadius;
  }

  if (node.absoluteBoundingBox) {
    filtered.absoluteBoundingBox = node.absoluteBoundingBox;
  }

  if (node.characters) {
    filtered.characters = node.characters;
  }

  if (node.style) {
    filtered.style = {
      fontFamily: node.style.fontFamily,
      fontStyle: node.style.fontStyle,
      fontWeight: node.style.fontWeight,
      fontSize: node.style.fontSize,
      textAlignHorizontal: node.style.textAlignHorizontal,
      letterSpacing: node.style.letterSpacing,
      lineHeightPx: node.style.lineHeightPx
    };
  }

  if (node.children) {
    filtered.children = node.children
      .map((child: any) => filterFigmaNode(child, node))
      .filter((child: any) => child !== null); // Remove null children (VECTOR nodes)
  }

  return filtered;
}

// Nodes Info Tool
server.tool(
  "get_nodes_info",
  "Get detailed information about multiple nodes in Figma",
  {
    nodeIds: z.array(z.string()).describe("Array of node IDs to get information about")
  },
  async ({ nodeIds }: any) => {
    try {
      const results = await Promise.all(
        nodeIds.map(async (nodeId: any) => {
          const result = await sendCommandToFigma('get_node_info', { nodeId });
          return { nodeId, info: result };
        })
      );
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(results.map((result) => filterFigmaNode(result.info)))
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error getting nodes info: ${error instanceof Error ? error.message : String(error)
              }`,
          },
        ],
      };
    }
  }
);


// Create Rectangle Tool
server.tool(
  "create_rectangle",
  "Create a new rectangle in Figma",
  {
    x: z.number().describe("X position"),
    y: z.number().describe("Y position"),
    width: z.number().describe("Width of the rectangle"),
    height: z.number().describe("Height of the rectangle"),
    name: z.string().optional().describe("Optional name for the rectangle"),
    parentId: z
      .string()
      .optional()
      .describe("Optional parent node ID to append the rectangle to"),
    fillColor: z
      .object({
        r: z.number().min(0).max(1).describe("Red component (0-1)"),
        g: z.number().min(0).max(1).describe("Green component (0-1)"),
        b: z.number().min(0).max(1).describe("Blue component (0-1)"),
        a: z.number().min(0).max(1).optional().describe("Alpha component (opacity, 0-1)"),
      })
      .optional()
      .describe("Fill color in RGBA format"),
    strokeColor: z
      .object({
        r: z.number().min(0).max(1).describe("Red component (0-1)"),
        g: z.number().min(0).max(1).describe("Green component (0-1)"),
        b: z.number().min(0).max(1).describe("Blue component (0-1)"),
        a: z.number().min(0).max(1).optional().describe("Alpha component (opacity, 0-1)"),
      })
      .optional()
      .describe("Stroke color in RGBA format"),
    strokeWeight: z
      .number()
      .positive()
      .optional()
      .describe("Stroke weight"),
    cornerRadius: z
      .number()
      .min(0)
      .optional()
      .describe("Corner radius"),
  },
  async ({ x, y, width, height, name, parentId, fillColor, strokeColor, strokeWeight, cornerRadius }: any) => {
    try {
      const result = await sendCommandToFigma("create_rectangle", {
        x,
        y,
        width,
        height,
        name: name || "Rectangle",
        parentId,
        fillColor,
        strokeColor,
        strokeWeight,
        cornerRadius,
      });
      return {
        content: [
          {
            type: "text",
            text: `Created rectangle "${JSON.stringify(result)}"`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error creating rectangle: ${error instanceof Error ? error.message : String(error)
              }`,
          },
        ],
      };
    }
  }
);

// Create Table Tool
server.tool(
  "create_table",
  "Create a table with custom dimensions and text content in Figma",
  {
    rows: z.number().min(1).max(20).describe("Number of rows in the table (1-20)"),
    columns: z.number().min(1).max(20).describe("Number of columns in the table (1-20)"),
    textData: z.array(z.array(z.string())).describe("2D array of text content for each cell. Should match the rows x columns dimensions."),
    x: z.number().optional().describe("X position for the table (default: 0)"),
    y: z.number().optional().describe("Y position for the table (default: 0)"),
    cellWidth: z.number().min(20).max(500).optional().describe("Width of each cell in pixels (default: 80)"),
    cellHeight: z.number().min(20).max(500).optional().describe("Height of each cell in pixels (default: 40)"),
    name: z.string().optional().describe("Name for the table frame"),
    fontSize: z.number().min(8).optional().describe("Font size for table text (default: 14)")
  },
  async ({ rows, columns, textData, x = 0, y = 0, cellWidth = 80, cellHeight = 40, name = "Table", fontSize = 14 }: any) => {
    try {
      // Validate textData dimensions
      if (!Array.isArray(textData) || textData.length !== rows) {
        throw new Error(`textData must be a 2D array with exactly ${rows} rows`);
      }
      
      for (let i = 0; i < textData.length; i++) {
        if (!Array.isArray(textData[i]) || textData[i].length !== columns) {
          throw new Error(`textData[${i}] must have exactly ${columns} columns`);
        }
      }

      const result = await sendCommandToFigma("create_table", {
        rows,
        columns,
        textData,
        x,
        y,
        cellWidth,
        cellHeight,
        name,
        fontSize
      });
      return {
        content: [
          {
            type: "text",
            text: `Table created: ${JSON.stringify(result)}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error creating table: ${error instanceof Error ? error.message : String(error)
              }`,
          },
        ],
      };
    }
  }
);

// Create Frame Tool
server.tool(
  "create_frame",
  "Create a new frame in Figma",
  {
    x: z.number().describe("X position"),
    y: z.number().describe("Y position"),
    width: z.number().describe("Width of the frame"),
    height: z.number().describe("Height of the frame"),
    name: z.string().optional().describe("Optional name for the frame"),
    parentId: z
      .string()
      .optional()
      .describe("Optional parent node ID to append the frame to"),
    fillColor: z
      .object({
        r: z.number().min(0).max(1).describe("Red component (0-1)"),
        g: z.number().min(0).max(1).describe("Green component (0-1)"),
        b: z.number().min(0).max(1).describe("Blue component (0-1)"),
        a: z
          .number()
          .min(0)
          .max(1)
          .optional()
          .describe("Alpha component (0-1)"),
      })
      .optional()
      .describe("Fill color in RGBA format"),
    strokeColor: z
      .object({
        r: z.number().min(0).max(1).describe("Red component (0-1)"),
        g: z.number().min(0).max(1).describe("Green component (0-1)"),
        b: z.number().min(0).max(1).describe("Blue component (0-1)"),
        a: z
          .number()
          .min(0)
          .max(1)
          .optional()
          .describe("Alpha component (0-1)"),
      })
      .optional()
      .describe("Stroke color in RGBA format"),
    strokeWeight: z.number().positive().optional().describe("Stroke weight"),
    layoutMode: z.enum(["NONE", "HORIZONTAL", "VERTICAL"]).optional().describe("Auto-layout mode for the frame"),
    layoutWrap: z.enum(["NO_WRAP", "WRAP"]).optional().describe("Whether the auto-layout frame wraps its children"),
    paddingTop: z.number().optional().describe("Top padding for auto-layout frame"),
    paddingRight: z.number().optional().describe("Right padding for auto-layout frame"),
    paddingBottom: z.number().optional().describe("Bottom padding for auto-layout frame"),
    paddingLeft: z.number().optional().describe("Left padding for auto-layout frame"),
    primaryAxisAlignItems: z
      .enum(["MIN", "MAX", "CENTER", "SPACE_BETWEEN"])
      .optional()
      .describe("Primary axis alignment for auto-layout frame. Note: When set to SPACE_BETWEEN, itemSpacing will be ignored as children will be evenly spaced."),
    counterAxisAlignItems: z.enum(["MIN", "MAX", "CENTER", "BASELINE"]).optional().describe("Counter axis alignment for auto-layout frame"),
    layoutSizingHorizontal: z.enum(["FIXED", "HUG", "FILL"]).optional().describe("Horizontal sizing mode for auto-layout frame"),
    layoutSizingVertical: z.enum(["FIXED", "HUG", "FILL"]).optional().describe("Vertical sizing mode for auto-layout frame"),
    itemSpacing: z
      .number()
      .optional()
      .describe("Distance between children in auto-layout frame. Note: This value will be ignored if primaryAxisAlignItems is set to SPACE_BETWEEN.")
  },
  async ({
    x,
    y,
    width,
    height,
    name,
    parentId,
    fillColor,
    strokeColor,
    strokeWeight,
    layoutMode,
    layoutWrap,
    paddingTop,
    paddingRight,
    paddingBottom,
    paddingLeft,
    primaryAxisAlignItems,
    counterAxisAlignItems,
    layoutSizingHorizontal,
    layoutSizingVertical,
    itemSpacing
  }: any) => {
    try {
      const result = await sendCommandToFigma("create_frame", {
        x,
        y,
        width,
        height,
        name: name || "Frame",
        parentId,
        fillColor: fillColor || { r: 1, g: 1, b: 1, a: 1 },
        strokeColor: strokeColor,
        strokeWeight: strokeWeight,
        layoutMode,
        layoutWrap,
        paddingTop,
        paddingRight,
        paddingBottom,
        paddingLeft,
        primaryAxisAlignItems,
        counterAxisAlignItems,
        layoutSizingHorizontal,
        layoutSizingVertical,
        itemSpacing
      });
      const typedResult = result as { name: string; id: string };
      return {
        content: [
          {
            type: "text",
            text: `Created frame "${typedResult.name}" with ID: ${typedResult.id}. Use the ID as the parentId to appendChild inside this frame.`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error creating frame: ${error instanceof Error ? error.message : String(error)
              }`,
          },
        ],
      };
    }
  }
);

// Create Text Tool
server.tool(
  "create_text",
  "Create a new text element in Figma",
  {
    x: z.number().describe("X position"),
    y: z.number().describe("Y position"),
    text: z.string().describe("Text content"),
    fontSize: z.number().optional().describe("Font size (default: 14)"),
    fontWeight: z
      .number()
      .optional()
      .describe("Font weight (e.g., 400 for Regular, 700 for Bold)"),
    fontColor: z
      .object({
        r: z.number().min(0).max(1).describe("Red component (0-1)"),
        g: z.number().min(0).max(1).describe("Green component (0-1)"),
        b: z.number().min(0).max(1).describe("Blue component (0-1)"),
        a: z
          .number()
          .min(0)
          .max(1)
          .optional()
          .describe("Alpha component (0-1)"),
      })
      .optional()
      .describe("Font color in RGBA format"),
    name: z
      .string()
      .optional()
      .describe("Semantic layer name for the text node"),
    parentId: z
      .string()
      .optional()
      .describe("Optional parent node ID to append the text to"),
  },
  async ({ x, y, text, fontSize, fontWeight, fontColor, name, parentId }: any) => {
    try {
      const result = await sendCommandToFigma("create_text", {
        x,
        y,
        text,
        fontSize: fontSize || 14,
        fontWeight: fontWeight || 400,
        fontColor: fontColor || { r: 0, g: 0, b: 0, a: 1 },
        name: name || "Text",
        parentId,
      });
      const typedResult = result as { name: string; id: string };
      return {
        content: [
          {
            type: "text",
            text: `Created text "${typedResult.name}" with ID: ${typedResult.id}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error creating text: ${error instanceof Error ? error.message : String(error)
              }`,
          },
        ],
      };
    }
  }
);

// // Create Circle Tool
server.tool(
  "create_ellipse",
  "Create a new circle/ellipse in Figma",
  {
    x: z.number().describe("X position"),
    y: z.number().describe("Y position"),
    width: z.number().positive().optional().describe("Width of the circle (default: radius * 2)"),
    height: z.number().positive().optional().describe("Height of the circle (default: radius * 2)"),
    radius: z.number().positive().optional().describe("Radius of the circle (ignored if width/height provided)"),
    fillColor: z
      .object({
        r: z.number().min(0).max(1).describe("Red component (0-1)"),
        g: z.number().min(0).max(1).describe("Green component (0-1)"),
        b: z.number().min(0).max(1).describe("Blue component (0-1)"),
        a: z
          .number()
          .min(0)
          .max(1)
          .optional()
          .describe("Alpha component (opacity, 0-1)"),
      })
      .optional()
      .describe("Fill color in RGBA format"),
    strokeColor: z
      .object({
        r: z.number().min(0).max(1).describe("Red component (0-1)"),
        g: z.number().min(0).max(1).describe("Green component (0-1)"),
        b: z.number().min(0).max(1).describe("Blue component (0-1)"),
        a: z
          .number()
          .min(0)
          .max(1)
          .optional()
          .describe("Alpha component (0-1)"),
      })
      .optional()
      .describe("Stroke color in RGBA format"),
    strokeWeight: z.number().positive().optional().describe("Stroke weight"),
    name: z.string().optional().describe("Optional name for the circle"),
    parentId: z
      .string()
      .optional()
      .describe("Optional parent node ID to append the circle to"),
  },
  async ({ x, y, width, height, radius, fillColor, strokeColor, strokeWeight, name, parentId }: any) => {
    try {
      // Calculate dimensions - prioritize width/height over radius
      let finalWidth, finalHeight;
      if (width !== undefined || height !== undefined) {
        finalWidth = width || height || 100;
        finalHeight = height || width || 100;
      } else {
        const circleRadius = radius || 50;
        finalWidth = circleRadius * 2;
        finalHeight = circleRadius * 2;
      }

      const result = await sendCommandToFigma("create_ellipse", {
        x,
        y,
        width: finalWidth,
        height: finalHeight,
        fillColor: fillColor || { r: 0.2, g: 0.4, b: 1, a: 1 }, // Default to blue
        strokeColor: strokeColor,
        strokeWeight: strokeWeight,
        name: name || "Circle",
        parentId,
      });
      const typedResult = result as { name: string; id: string };
      return {
        content: [
          {
            type: "text",
            text: `Created circle "${typedResult.name}" with ID: ${typedResult.id} (${finalWidth}x${finalHeight})`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error creating circle: ${error instanceof Error ? error.message : String(error)
              }`,
          },
        ],
      };
    }
  }
);

// Create Vector Tool
server.tool(
  "create_vector",
  "Create a new vector shape in Figma using SVG path data",
  {
    x: z.number().describe("X position"),
    y: z.number().describe("Y position"),
    vectorPaths: z.array(z.object({
      windingRule: z.enum(["EVENODD", "NONZERO"]).optional().describe("Winding rule for the path (default: EVENODD)"),
      data: z.string().describe("SVG path data string (e.g., 'M 0 100 L 100 100 L 50 0 Z' for a triangle)")
    })).describe("Array of vector path objects defining the shape"),
    name: z.string().optional().describe("Optional name for the vector"),
    parentId: z
      .string()
      .optional()
      .describe("Optional parent node ID to append the vector to"),
    fillColor: z
      .object({
        r: z.number().min(0).max(1).describe("Red component (0-1)"),
        g: z.number().min(0).max(1).describe("Green component (0-1)"),
        b: z.number().min(0).max(1).describe("Blue component (0-1)"),
        a: z.number().min(0).max(1).optional().describe("Alpha component (opacity, 0-1)"),
      })
      .optional()
      .describe("Fill color in RGBA format"),
    strokeColor: z
      .object({
        r: z.number().min(0).max(1).describe("Red component (0-1)"),
        g: z.number().min(0).max(1).describe("Green component (0-1)"),
        b: z.number().min(0).max(1).describe("Blue component (0-1)"),
        a: z.number().min(0).max(1).optional().describe("Alpha component (opacity, 0-1)"),
      })
      .optional()
      .describe("Stroke color in RGBA format"),
    strokeWeight: z
      .number()
      .positive()
      .optional()
      .describe("Stroke weight"),
  },
  async ({ x, y, vectorPaths, name, parentId, fillColor, strokeColor, strokeWeight }: any) => {
    try {
      // Ensure each path has a default windingRule if not provided
      const processedPaths = vectorPaths.map((path: any) => ({
        windingRule: path.windingRule || "EVENODD",
        data: path.data
      }));

      const result = await sendCommandToFigma("create_vector", {
        x,
        y,
        vectorPaths: processedPaths,
        fillColor: fillColor || { r: 0.2, g: 0.4, b: 1, a: 1 }, // Default to blue
        strokeColor: strokeColor,
        strokeWeight: strokeWeight,
        name: name || "Vector",
        parentId,
      });
      const typedResult = result as { name: string; id: string };
      return {
        content: [
          {
            type: "text",
            text: `Created vector "${typedResult.name}" with ID: ${typedResult.id}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error creating vector: ${error instanceof Error ? error.message : String(error)
              }`,
          },
        ],
      };
    }
  }
);

// Set Fill Color Tool
server.tool(
  "set_fill_color",
  "Set the fill color or gradient of a node in Figma. Can be TextNode or FrameNode. Supports both solid colors and gradients.",
  {
    nodeId: z.string().describe("The ID of the node to modify"),
    // Solid color parameters
    r: z.number().min(0).max(1).optional().describe("Red component (0-1) for solid colors"),
    g: z.number().min(0).max(1).optional().describe("Green component (0-1) for solid colors"),
    b: z.number().min(0).max(1).optional().describe("Blue component (0-1) for solid colors"),
    a: z.number().min(0).max(1).optional().describe("Alpha component (0-1) for solid colors"),
    // Gradient parameters
    gradientType: z.enum(["GRADIENT_LINEAR", "GRADIENT_RADIAL", "GRADIENT_ANGULAR", "GRADIENT_DIAMOND"]).optional().describe("Type of gradient"),
    gradientStops: z.array(z.object({
      position: z.number().min(0).max(1).describe("Position of the gradient stop (0-1)"),
      color: z.object({
        r: z.number().min(0).max(1).describe("Red component (0-1)"),
        g: z.number().min(0).max(1).describe("Green component (0-1)"),
        b: z.number().min(0).max(1).describe("Blue component (0-1)"),
        a: z.number().min(0).max(1).optional().describe("Alpha component (0-1)"),
      }).describe("Color of the gradient stop")
    })).optional().describe("Array of gradient stops with position and color"),
    gradientTransform: z.array(z.array(z.number())).optional().describe("Optional 2x3 transformation matrix for gradient positioning"),
  },
  async ({ nodeId, r, g, b, a, gradientType, gradientStops, gradientTransform }: any) => {
    try {
      let commandParams: any = { nodeId };

      // Check if gradient parameters are provided
      if (gradientStops && Array.isArray(gradientStops)) {
        // Gradient fill
        commandParams.gradientType = gradientType || 'GRADIENT_LINEAR';
        commandParams.gradientStops = gradientStops;
        if (gradientTransform) {
          commandParams.gradientTransform = gradientTransform;
        }

        const result = await sendCommandToFigma("set_fill_color", commandParams);
        const typedResult = result as { name: string };
        return {
          content: [
            {
              type: "text",
              text: `Set gradient fill of node "${typedResult.name}" to ${gradientType || 'GRADIENT_LINEAR'} with ${gradientStops.length} stops`,
            },
          ],
        };
      } else {
        // Solid color fill (existing behavior)
        if (r === undefined || g === undefined || b === undefined) {
          throw new Error("For solid colors, r, g, and b parameters are required");
        }

        commandParams.color = { r, g, b, a: a || 1 };

        const result = await sendCommandToFigma("set_fill_color", commandParams);
        const typedResult = result as { name: string };
        return {
          content: [
            {
              type: "text",
              text: `Set fill color of node "${typedResult.name}" to RGBA(${r}, ${g}, ${b}, ${a || 1})`,
            },
          ],
        };
      }
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error setting fill: ${error instanceof Error ? error.message : String(error)
              }`,
          },
        ],
      };
    }
  }
);

// Set Stroke Color Tool
server.tool(
  "set_stroke_color",
  "Set the stroke color of a node in Figma",
  {
    nodeId: z.string().describe("The ID of the node to modify"),
    r: z.number().min(0).max(1).describe("Red component (0-1)"),
    g: z.number().min(0).max(1).describe("Green component (0-1)"),
    b: z.number().min(0).max(1).describe("Blue component (0-1)"),
    a: z.number().min(0).max(1).optional().describe("Alpha component (0-1)"),
    weight: z.number().positive().optional().describe("Stroke weight"),
  },
  async ({ nodeId, r, g, b, a, weight }: any) => {
    try {
      const result = await sendCommandToFigma("set_stroke_color", {
        nodeId,
        color: { r, g, b, a: a || 1 },
        weight: weight || 1,
      });
      const typedResult = result as { name: string };
      return {
        content: [
          {
            type: "text",
            text: `Set stroke color of node "${typedResult.name
              }" to RGBA(${r}, ${g}, ${b}, ${a || 1}) with weight ${weight || 1}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error setting stroke color: ${error instanceof Error ? error.message : String(error)
              }`,
          },
        ],
      };
    }
  }
);

// Move Node Tool
server.tool(
  "move_node",
  "Move a node to a new position in Figma",
  {
    nodeId: z.string().describe("The ID of the node to move"),
    x: z.number().describe("New X position"),
    y: z.number().describe("New Y position"),
  },
  async ({ nodeId, x, y }: any) => {
    try {
      const result = await sendCommandToFigma("move_node", { nodeId, x, y });
      const typedResult = result as { name: string };
      return {
        content: [
          {
            type: "text",
            text: `Moved node "${typedResult.name}" to position (${x}, ${y})`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error moving node: ${error instanceof Error ? error.message : String(error)
              }`,
          },
        ],
      };
    }
  }
);

// Clone Node Tool
server.tool(
  "clone_node",
  "Clone an existing node in Figma",
  {
    nodeId: z.string().describe("The ID of the node to clone"),
    x: z.number().optional().describe("New X position for the clone"),
    y: z.number().optional().describe("New Y position for the clone"),
    parentId: z.string().optional().describe("Optional parent node ID to append the clone to"),
    insertAtIndex: z.number().optional().describe("Index position to insert the clone within the parent (0-based)")
  },
  async ({ nodeId, x, y, parentId, insertAtIndex }: any) => {
    try {
      const result = await sendCommandToFigma('clone_node', { nodeId, x, y, parentId, insertAtIndex });
      const typedResult = result as { name: string, id: string };
      return {
        content: [
          {
            type: "text",
            text: `Cloned node "${typedResult.name}" with new ID: ${typedResult.id}${x !== undefined && y !== undefined ? ` at position (${x}, ${y})` : ''}${parentId ? ` under parent ${parentId}` : ''}${insertAtIndex !== undefined ? ` at index ${insertAtIndex}` : ''}`
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error cloning node: ${error instanceof Error ? error.message : String(error)}`
          }
        ]
      };
    }
  }
);

server.tool(
  "resize_node",
  "Resize a node in Figma",
  {
    nodeId: z.string().describe("The ID of the node to resize"),
    width: z.number().positive().describe("New width"),
    height: z.number().positive().describe("New height"),
  },
  async ({ nodeId, width, height }: any) => {
    try {
      const result = await sendCommandToFigma("resize_node", {
        nodeId,
        width,
        height,
      });
      const typedResult = result as { name: string };
      return {
        content: [
          {
            type: "text",
            text: `Resized node "${typedResult.name}" to width ${width} and height ${height}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error resizing node: ${error instanceof Error ? error.message : String(error)
              }`,
          },
        ],
      };
    }
  }
);

// Delete Node Tool
server.tool(
  "delete_node",
  "Delete a node from Figma",
  {
    nodeId: z.string().describe("The ID of the node to delete"),
  },
  async ({ nodeId }: any) => {
    try {
      await sendCommandToFigma("delete_node", { nodeId });
      return {
        content: [
          {
            type: "text",
            text: `Deleted node with ID: ${nodeId}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error deleting node: ${error instanceof Error ? error.message : String(error)
              }`,
          },
        ],
      };
    }
  }
);

// Delete Multiple Nodes Tool
server.tool(
  "delete_multiple_nodes",
  "Delete multiple nodes from Figma at once",
  {
    nodeIds: z.array(z.string()).describe("Array of node IDs to delete"),
  },
  async ({ nodeIds }: any) => {
    try {
      const result = await sendCommandToFigma("delete_multiple_nodes", { nodeIds });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result)
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error deleting multiple nodes: ${error instanceof Error ? error.message : String(error)
              }`,
          },
        ],
      };
    }
  }
);

// Export Node as Image Tool
server.tool(
  "export_node_as_image",
  "Export a node as an image from Figma",
  {
    nodeId: z.string().describe("The ID of the node to export"),
    format: z
      .enum(["PNG", "JPG", "SVG", "PDF"])
      .optional()
      .describe("Export format"),
    scale: z.number().positive().optional().describe("Export scale"),
  },
  async ({ nodeId, format, scale }: any) => {
    try {
      const result = await sendCommandToFigma("export_node_as_image", {
        nodeId,
        format: format || "PNG",
        scale: scale || 1,
      });
      const typedResult = result as { imageData: string; mimeType: string };

      return {
        content: [
          {
            type: "image",
            data: typedResult.imageData,
            mimeType: typedResult.mimeType || "image/png",
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error exporting node as image: ${error instanceof Error ? error.message : String(error)
              }`,
          },
        ],
      };
    }
  }
);

// Set Text Content Tool
server.tool(
  "set_text_content",
  "Set the text content of an existing text node in Figma",
  {
    nodeId: z.string().describe("The ID of the text node to modify"),
    text: z.string().describe("New text content"),
  },
  async ({ nodeId, text }: any) => {
    try {
      const result = await sendCommandToFigma("set_text_content", {
        nodeId,
        text,
      });
      const typedResult = result as { name: string };
      return {
        content: [
          {
            type: "text",
            text: `Updated text content of node "${typedResult.name}" to "${text}"`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error setting text content: ${error instanceof Error ? error.message : String(error)
              }`,
          },
        ],
      };
    }
  }
);

// Insert Image Data Tool
server.tool(
  "insert_image_data",
  "Insert an image from base64 data into the selected frame in Figma",
  {
    imageData: z.string().describe("Base64 encoded image data"),
    frameId: z.string().optional().describe("ID of the frame to insert the image into. If not provided, uses the currently selected frame"),
    x: z.number().optional().describe("X position within the frame (default: 0)"),
    y: z.number().optional().describe("Y position within the frame (default: 0)"),
    width: z.number().optional().describe("Width of the image (default: image natural width)"),
    height: z.number().optional().describe("Height of the image (default: image natural height)"),
  },
  async ({ imageData, frameId, x = 0, y = 0, width, height }: any) => {
    try {
      const result = await sendCommandToFigma("insert_image_data", {
        imageData,
        frameId,
        x,
        y,
        width,
        height,
      });
      const typedResult = result as { nodeId: string; name: string };
      return {
        content: [
          {
            type: "text",
            text: `Successfully inserted image into frame "${typedResult.name}" with node ID: ${typedResult.nodeId}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error inserting image: ${error instanceof Error ? error.message : String(error)
              }`,
          },
        ],
      };
    }
  }
);

// Insert Image From File Tool
server.tool(
  "insert_image_from_file",
  "Insert an image from a PNG file into the selected frame in Figma. Automatically converts PNG to base64 and compresses large images to ensure they work properly in Figma. Uses intelligent size limits: 200KB for very large images (>2MB or >10M pixels), 400KB for large images (500KB-2MB or 2M-10M pixels), or 800KB for smaller images.",
  {
    filePath: z.string().describe("Path to the PNG image file (relative to project root or absolute path)"),
    frameId: z.string().optional().describe("ID of the frame to insert the image into. If not provided, uses the currently selected frame"),
    x: z.number().optional().describe("X position within the frame (default: 0)"),
    y: z.number().optional().describe("Y position within the frame (default: 0)"),
    width: z.number().optional().describe("Width of the image (default: image natural width)"),
    height: z.number().optional().describe("Height of the image (default: image natural height)"),
    maxSizeKB: z.number().optional().describe("Maximum size in KB (auto-selected based on image size and pixel count if not specified: 200KB for >2MB images or >10M pixels, 400KB for 500KB-2MB images or 2M-10M pixels, 800KB for smaller images)"),
  },
  async ({ filePath, frameId, x = 0, y = 0, width, height, maxSizeKB }: any) => {
    try {
      // Resolve the file path relative to the current working directory
      const resolvedPath = resolve(process.cwd(), filePath);
      
      if (!existsSync(resolvedPath)) {
        throw new Error(`File not found: ${resolvedPath}`);
      }

      // Check file size and get image metadata for intelligent size selection
      const stats = statSync(resolvedPath);
      const fileSizeKB = stats.size / 1024;
      
      // Get image metadata to calculate pixel count for better size prediction
      const metadata = await sharp(resolvedPath).metadata();
      const pixelCount = (metadata.width || 800) * (metadata.height || 600);
      
      logger.info(`Image file size: ${fileSizeKB.toFixed(2)} KB, dimensions: ${metadata.width}x${metadata.height} (${pixelCount} pixels)`);

      // Dynamically set maxSizeKB based on both file size and pixel count for optimal first-attempt success
      if (maxSizeKB === undefined) {
        if (fileSizeKB > 2000 || pixelCount > 10000000) {
          maxSizeKB = 200; // For very large images (>2MB or >10M pixels), target 200KB
        } else if (fileSizeKB > 500 || pixelCount > 2000000) {
          maxSizeKB = 400; // For large images (500KB-2MB or 2M-10M pixels), target 400KB
        } else {
          maxSizeKB = 400; // For smaller images (<500KB and <2M pixels), target 800KB
        }
        logger.info(`Auto-selected maxSizeKB: ${maxSizeKB} KB for ${fileSizeKB.toFixed(2)} KB image (${pixelCount} pixels)`);
      }

      let imageBuffer: Buffer;
      let finalSizeKB: number;

      if (fileSizeKB > maxSizeKB) {
        logger.info(`Image size (${fileSizeKB.toFixed(2)} KB) exceeds limit (${maxSizeKB} KB). Compressing image...`);
        
        // Use sharp to compress the image
        const compressedBuffer = await compressImageWithSharp(resolvedPath, maxSizeKB);
        imageBuffer = compressedBuffer;
        finalSizeKB = compressedBuffer.length / 1024;
        
        logger.info(`Image compressed from ${fileSizeKB.toFixed(2)} KB to ${finalSizeKB.toFixed(2)} KB`);
      } else {
        // For smaller images, use as-is
        imageBuffer = readFileSync(resolvedPath);
        finalSizeKB = fileSizeKB;
      }

      const imageData = imageBuffer.toString('base64');
      
      // Call the existing insert_image_data tool
      const result = await sendCommandToFigma("insert_image_data", {
        imageData,
        frameId,
        x,
        y,
        width,
        height,
      });
      
      const typedResult = result as { nodeId: string; name: string; frameId: string; frameName: string; width: number; height: number };
      return {
        content: [
          {
            type: "text" as const,
            text: `Successfully inserted image "${filePath}" into frame "${typedResult.frameName}" with node ID: ${typedResult.nodeId}. ${fileSizeKB > maxSizeKB ? `Original size: ${fileSizeKB.toFixed(2)} KB, compressed to: ${finalSizeKB.toFixed(2)} KB` : `Size: ${finalSizeKB.toFixed(2)} KB`}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error inserting image from file "${filePath}": ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  }
);

// Insert Website Screenshot Tool
server.tool(
  "insert_website_screenshot",
  "Take a screenshot of a website and insert it into a Figma frame. Supports specifying a frameId explicitly, positioning with x/y coordinates, or using the currently selected frame. When useSelectedFrame is true, gets the current frame selection and uses that frame ID for insertion. Automatically handles URL parsing, screenshot capture with Puppeteer, and image insertion with compression.",
  {
    website: z.string().describe("The website name or URL to screenshot (e.g., 'facebook', 'https://facebook.com', 'google.com')"),
    frameId: z.string().describe("ID of the frame to insert the image into"),
    useSelectedFrame: z.boolean().optional().describe("If true, gets the current frame selection and uses that frame ID for insertion. Useful for inserting multiple screenshots into the same frame"),
    x: z.number().optional().describe("X position within the frame (default: 0)"),
    y: z.number().optional().describe("Y position within the frame (default: 0)"),
    width: z.number().optional().describe("Width of the image (default: image natural width)"),
    height: z.number().optional().describe("Height of the image (default: image natural height)"),
    maxSizeKB: z.number().optional().describe("Maximum size in KB for compression (auto-selected based on image size if not specified)"),
  },
  async ({ website, frameId, useSelectedFrame = false, x = 0, y = 0, width, height, maxSizeKB }: any) => {
    try {
      let targetFrameId = frameId;

      // If useSelectedFrame is true, get the current selection to override frameId
      if (useSelectedFrame) {
        const selectionResult = await sendCommandToFigma("get_selection");
        const selection = selectionResult as any[];
        if (selection && selection.length > 0) {
          // Find the first frame in the selection
          const frameNode = selection.find(node => node.type === 'FRAME');
          if (frameNode) {
            targetFrameId = frameNode.id;
            logger.info(`Using selected frame: ${frameNode.name} (ID: ${targetFrameId})`);
          } else {
            // If no frame selected, use the first selected node as parent
            targetFrameId = selection[0].id;
            logger.info(`No frame selected, using selected node: ${selection[0].name} (ID: ${targetFrameId})`);
          }
        } else {
          throw new Error("No frame or node selected in Figma. Please select a frame first.");
        }
      }

      // Parse website URL - add https:// if not present
      let url = website;
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = `https://${url}`;
      }

      // Generate filename based on website name
      const websiteName = website.replace(/https?:\/\//, '').replace(/[^a-zA-Z0-9]/g, '-');
      const filename = `screenshots/${websiteName}-screenshot.png`;
      const filepath = resolve(process.cwd(), filename);

      logger.info(`Taking screenshot of ${url} and saving to ${filename}`);

      // Take screenshot using puppeteer
      const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });

      const page = await browser.newPage();
      await page.setViewport({ width: 1920, height: 1080 });

      await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });

      await page.screenshot({
        path: filepath as `${string}.png`,
        fullPage: true,
        type: 'png'
      });

      await browser.close();

      logger.info(`Screenshot saved to ${filename}, now inserting into Figma`);

      // Now insert the image using the existing insert_image_from_file logic
      if (!existsSync(filepath)) {
        throw new Error(`Screenshot file not found: ${filepath}`);
      }

      // Check file size and get image metadata
      const stats = statSync(filepath);
      const fileSizeKB = stats.size / 1024;

      const metadata = await sharp(filepath).metadata();
      const pixelCount = (metadata.width || 800) * (metadata.height || 600);

      logger.info(`Screenshot file size: ${fileSizeKB.toFixed(2)} KB, dimensions: ${metadata.width}x${metadata.height}`);

      // Set maxSizeKB if not provided
      if (maxSizeKB === undefined) {
        if (fileSizeKB > 2000 || pixelCount > 10000000) {
          maxSizeKB = 200;
        } else if (fileSizeKB > 500 || pixelCount > 2000000) {
          maxSizeKB = 400;
        } else {
          maxSizeKB = 400;
        }
        logger.info(`Auto-selected maxSizeKB: ${maxSizeKB} KB for screenshot`);
      }

      let imageBuffer: Buffer;
      let finalSizeKB: number;

      if (fileSizeKB > maxSizeKB) {
        logger.info(`Screenshot size (${fileSizeKB.toFixed(2)} KB) exceeds limit (${maxSizeKB} KB). Compressing...`);
        const compressedBuffer = await compressImageWithSharp(filepath, maxSizeKB);
        imageBuffer = compressedBuffer;
        finalSizeKB = compressedBuffer.length / 1024;
        logger.info(`Screenshot compressed from ${fileSizeKB.toFixed(2)} KB to ${finalSizeKB.toFixed(2)} KB`);
      } else {
        imageBuffer = readFileSync(filepath);
        finalSizeKB = fileSizeKB;
      }

      const imageData = imageBuffer.toString('base64');

      // Insert into Figma
      const result = await sendCommandToFigma("insert_image_data", {
        imageData,
        frameId: targetFrameId,
        x,
        y,
        width,
        height,
      });

      const typedResult = result as { nodeId: string; name: string; frameId: string; frameName: string; width: number; height: number };

      return {
        content: [
          {
            type: "text" as const,
            text: `Successfully captured screenshot of ${url} and inserted into frame "${typedResult.frameName}" (ID: ${typedResult.frameId}) with node ID: ${typedResult.nodeId}. ${fileSizeKB > maxSizeKB ? `Original size: ${fileSizeKB.toFixed(2)} KB, compressed to: ${finalSizeKB.toFixed(2)} KB` : `Size: ${finalSizeKB.toFixed(2)} KB`}${useSelectedFrame && !frameId ? ` | Used selected frame: ${typedResult.frameId}` : ''}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error taking screenshot and inserting image: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  }
);

// Get Styles Tool
server.tool(
  "get_styles",
  "Get all styles from the current Figma document",
  {},
  async () => {
    try {
      const result = await sendCommandToFigma("get_styles");
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result)
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error getting styles: ${error instanceof Error ? error.message : String(error)
              }`,
          },
        ],
      };
    }
  }
);

// Get Local Components Tool
server.tool(
  "get_local_components",
  "Get all local components from the Figma document",
  {},
  async () => {
    try {
      const result = await sendCommandToFigma("get_local_components");
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result)
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error getting local components: ${error instanceof Error ? error.message : String(error)
              }`,
          },
        ],
      };
    }
  }
);

// Get Annotations Tool
server.tool(
  "get_annotations",
  "Get all annotations in the current document or specific node",
  {
    nodeId: z.string().describe("node ID to get annotations for specific node"),
    includeCategories: z.boolean().optional().default(true).describe("Whether to include category information")
  },
  async ({ nodeId, includeCategories }: any) => {
    try {
      const result = await sendCommandToFigma("get_annotations", {
        nodeId,
        includeCategories
      });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result)
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error getting annotations: ${error instanceof Error ? error.message : String(error)}`
          }
        ]
      };
    }
  }
);

// Set Annotation Tool
server.tool(
  "set_annotation",
  "Create or update an annotation",
  {
    nodeId: z.string().describe("The ID of the node to annotate"),
    annotationId: z.string().optional().describe("The ID of the annotation to update (if updating existing annotation)"),
    labelMarkdown: z.string().describe("The annotation text in markdown format"),
    categoryId: z.string().optional().describe("The ID of the annotation category"),
    properties: z.array(z.object({
      type: z.string()
    })).optional().describe("Additional properties for the annotation")
  },
  async ({ nodeId, annotationId, labelMarkdown, categoryId, properties }: any) => {
    try {
      const result = await sendCommandToFigma("set_annotation", {
        nodeId,
        annotationId,
        labelMarkdown,
        categoryId,
        properties
      });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result)
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error setting annotation: ${error instanceof Error ? error.message : String(error)}`
          }
        ]
      };
    }
  }
);

interface SetMultipleAnnotationsParams {
  nodeId: string;
  annotations: Array<{
    nodeId: string;
    labelMarkdown: string;
    categoryId?: string;
    annotationId?: string;
    properties?: Array<{ type: string }>;
  }>;
}

// Set Multiple Annotations Tool
server.tool(
  "set_multiple_annotations",
  "Set multiple annotations parallelly in a node",
  {
    nodeId: z
      .string()
      .describe("The ID of the node containing the elements to annotate"),
    annotations: z
      .array(
        z.object({
          nodeId: z.string().describe("The ID of the node to annotate"),
          labelMarkdown: z.string().describe("The annotation text in markdown format"),
          categoryId: z.string().optional().describe("The ID of the annotation category"),
          annotationId: z.string().optional().describe("The ID of the annotation to update (if updating existing annotation)"),
          properties: z.array(z.object({
            type: z.string()
          })).optional().describe("Additional properties for the annotation")
        })
      )
      .describe("Array of annotations to apply"),
  },
  async ({ nodeId, annotations }: any) => {
    try {
      if (!annotations || annotations.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: "No annotations provided",
            },
          ],
        };
      }

      // Initial response to indicate we're starting the process
      const initialStatus = {
        type: "text" as const,
        text: `Starting annotation process for ${annotations.length} nodes. This will be processed in batches of 5...`,
      };

      // Track overall progress
      let totalProcessed = 0;
      const totalToProcess = annotations.length;

      // Use the plugin's set_multiple_annotations function with chunking
      const result = await sendCommandToFigma("set_multiple_annotations", {
        nodeId,
        annotations,
      });

      // Cast the result to a specific type to work with it safely
      interface AnnotationResult {
        success: boolean;
        nodeId: string;
        annotationsApplied?: number;
        annotationsFailed?: number;
        totalAnnotations?: number;
        completedInChunks?: number;
        results?: Array<{
          success: boolean;
          nodeId: string;
          error?: string;
          annotationId?: string;
        }>;
      }

      const typedResult = result as AnnotationResult;

      // Format the results for display
      const success = typedResult.annotationsApplied && typedResult.annotationsApplied > 0;
      const progressText = `
      Annotation process completed:
      - ${typedResult.annotationsApplied || 0} of ${totalToProcess} successfully applied
      - ${typedResult.annotationsFailed || 0} failed
      - Processed in ${typedResult.completedInChunks || 1} batches
      `;

      // Detailed results
      const detailedResults = typedResult.results || [];
      const failedResults = detailedResults.filter(item => !item.success);

      // Create the detailed part of the response
      let detailedResponse = "";
      if (failedResults.length > 0) {
        detailedResponse = `\n\nNodes that failed:\n${failedResults.map(item =>
          `- ${item.nodeId}: ${item.error || "Unknown error"}`
        ).join('\n')}`;
      }

      return {
        content: [
          initialStatus,
          {
            type: "text" as const,
            text: progressText + detailedResponse,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error setting multiple annotations: ${error instanceof Error ? error.message : String(error)
              }`,
          },
        ],
      };
    }
  }
);

// Create Component Instance Tool
server.tool(
  "create_component_instance",
  "Create an instance of a component in Figma",
  {
    componentKey: z.string().describe("Key of the component to instantiate"),
    x: z.number().describe("X position"),
    y: z.number().describe("Y position"),
  },
  async ({ componentKey, x, y }: any) => {
    try {
      const result = await sendCommandToFigma("create_component_instance", {
        componentKey,
        x,
        y,
      });
      const typedResult = result as any;
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(typedResult),
          }
        ]
      }
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error creating component instance: ${error instanceof Error ? error.message : String(error)
              }`,
          },
        ],
      };
    }
  }
);

// Copy Instance Overrides Tool
server.tool(
  "get_instance_overrides",
  "Get all override properties from a selected component instance. These overrides can be applied to other instances, which will swap them to match the source component.",
  {
    nodeId: z.string().optional().describe("Optional ID of the component instance to get overrides from. If not provided, currently selected instance will be used."),
  },
  async ({ nodeId }: any) => {
    try {
      const result = await sendCommandToFigma("get_instance_overrides", {
        instanceNodeId: nodeId || null
      });
      const typedResult = result as getInstanceOverridesResult;

      return {
        content: [
          {
            type: "text",
            text: typedResult.success
              ? `Successfully got instance overrides: ${typedResult.message}`
              : `Failed to get instance overrides: ${typedResult.message}`
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error copying instance overrides: ${error instanceof Error ? error.message : String(error)}`
          }
        ]
      };
    }
  }
);

// Set Instance Overrides Tool
server.tool(
  "set_instance_overrides",
  "Apply previously copied overrides to selected component instances. Target instances will be swapped to the source component and all copied override properties will be applied.",
  {
    sourceInstanceId: z.string().describe("ID of the source component instance"),
    targetNodeIds: z.array(z.string()).describe("Array of target instance IDs. Currently selected instances will be used.")
  },
  async ({ sourceInstanceId, targetNodeIds }: any) => {
    try {
      const result = await sendCommandToFigma("set_instance_overrides", {
        sourceInstanceId: sourceInstanceId,
        targetNodeIds: targetNodeIds || []
      });
      const typedResult = result as setInstanceOverridesResult;

      if (typedResult.success) {
        const successCount = typedResult.results?.filter(r => r.success).length || 0;
        return {
          content: [
            {
              type: "text",
              text: `Successfully applied ${typedResult.totalCount || 0} overrides to ${successCount} instances.`
            }
          ]
        };
      } else {
        return {
          content: [
            {
              type: "text",
              text: `Failed to set instance overrides: ${typedResult.message}`
            }
          ]
        };
      }
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error setting instance overrides: ${error instanceof Error ? error.message : String(error)}`
          }
        ]
      };
    }
  }
);

// Detach Instance Tool
server.tool(
  "detach_instance",
  "Detach an instance from its component, converting it into a regular frame. This breaks the link to the main component and allows full editing freedom. For nested instances, also detaches all ancestor instances.",
  {
    nodeId: z.string().describe("The ID of the instance node to detach")
  },
  async ({ nodeId }: any) => {
    try {
      const result = await sendCommandToFigma("detach_instance", {
        nodeId
      });
      const typedResult = result as {
        success: boolean;
        message: string;
        detachedNode: {
          id: string;
          name: string;
          type: string;
          x: number;
          y: number;
          width: number;
          height: number;
        };
        originalInstance: {
          id: string;
          name: string;
        };
        mainComponent: {
          id: string;
          name: string;
          key: string;
        } | null;
      };

      return {
        content: [
          {
            type: "text",
            text: typedResult.success
              ? `${typedResult.message}\n\nDetached node:\n- ID: ${typedResult.detachedNode.id}\n- Name: ${typedResult.detachedNode.name}\n- Type: ${typedResult.detachedNode.type}\n\nOriginal component: ${typedResult.mainComponent?.name || 'unknown'}`
              : `Failed to detach instance: ${typedResult.message}`
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error detaching instance: ${error instanceof Error ? error.message : String(error)}`
          }
        ]
      };
    }
  }
);


// Set Corner Radius Tool
server.tool(
  "set_corner_radius",
  "Set the corner radius of a node in Figma",
  {
    nodeId: z.string().describe("The ID of the node to modify"),
    radius: z.number().min(0).describe("Corner radius value"),
    corners: z
      .array(z.boolean())
      .length(4)
      .optional()
      .describe(
        "Optional array of 4 booleans to specify which corners to round [topLeft, topRight, bottomRight, bottomLeft]"
      ),
  },
  async ({ nodeId, radius, corners }: any) => {
    try {
      const result = await sendCommandToFigma("set_corner_radius", {
        nodeId,
        radius,
        corners: corners || [true, true, true, true],
      });
      const typedResult = result as { name: string };
      return {
        content: [
          {
            type: "text",
            text: `Set corner radius of node "${typedResult.name}" to ${radius}px`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error setting corner radius: ${error instanceof Error ? error.message : String(error)
              }`,
          },
        ],
      };
    }
  }
);

// Register all prompts from prompts.ts
registerPrompts(server);

// Scan nodes by types Tool (replaces get_components)
server.tool(
  "scan_nodes_by_types",
  "Scan for child nodes with specific types in the selected Figma node",
  {
    nodeId: z.string().describe("ID of the node to scan"),
    types: z
      .array(z.string())
      .describe("Array of node types to find in the child nodes (e.g. ['COMPONENT', 'FRAME'])"),
  },
  async ({ nodeId, types }: any) => {
    try {
      const result = await sendCommandToFigma("scan_nodes_by_types", {
        nodeId,
        types,
      });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error scanning nodes by types: ${error instanceof Error ? error.message : String(error)
              }`,
          },
        ],
      };
    }
  }
);

// Text Node Scanning Tool
server.tool(
  "scan_text_nodes",
  "Scan all text nodes in the selected Figma node",
  {
    nodeId: z.string().describe("ID of the node to scan"),
  },
  async ({ nodeId }: any) => {
    try {
      // Initial response to indicate we're starting the process
      const initialStatus = {
        type: "text" as const,
        text: "Starting text node scanning. This may take a moment for large designs...",
      };

      // Use the plugin's scan_text_nodes function with chunking flag
      const result = await sendCommandToFigma("scan_text_nodes", {
        nodeId,
        useChunking: true,  // Enable chunking on the plugin side
        chunkSize: 10       // Process 10 nodes at a time
      });

      // If the result indicates chunking was used, format the response accordingly
      if (result && typeof result === 'object' && 'chunks' in result) {
        const typedResult = result as {
          success: boolean,
          totalNodes: number,
          processedNodes: number,
          chunks: number,
          textNodes: Array<any>
        };

        const summaryText = `
        Scan completed:
        - Found ${typedResult.totalNodes} text nodes
        - Processed in ${typedResult.chunks} chunks
        `;

        return {
          content: [
            initialStatus,
            {
              type: "text" as const,
              text: summaryText
            },
            {
              type: "text" as const,
              text: JSON.stringify(typedResult.textNodes, null, 2)
            }
          ],
        };
      }

      // If chunking wasn't used or wasn't reported in the result format, return the result as is
      return {
        content: [
          initialStatus,
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error scanning text nodes: ${error instanceof Error ? error.message : String(error)
              }`,
          },
        ],
      };
    }
  }
);

// Set Multiple Text Contents Tool
server.tool(
  "set_multiple_text_contents",
  "Set multiple text contents parallelly in a node",
  {
    nodeId: z
      .string()
      .describe("The ID of the node containing the text nodes to replace"),
    text: z
      .array(
        z.object({
          nodeId: z.string().describe("The ID of the text node"),
          text: z.string().describe("The replacement text"),
        })
      )
      .describe("Array of text node IDs and their replacement texts"),
  },
  async ({ nodeId, text }: any) => {
    try {
      if (!text || text.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: "No text provided",
            },
          ],
        };
      }

      // Initial response to indicate we're starting the process
      const initialStatus = {
        type: "text" as const,
        text: `Starting text replacement for ${text.length} nodes. This will be processed in batches of 5...`,
      };

      // Track overall progress
      let totalProcessed = 0;
      const totalToProcess = text.length;

      // Use the plugin's set_multiple_text_contents function with chunking
      const result = await sendCommandToFigma("set_multiple_text_contents", {
        nodeId,
        text,
      });

      // Cast the result to a specific type to work with it safely
      interface TextReplaceResult {
        success: boolean;
        nodeId: string;
        replacementsApplied?: number;
        replacementsFailed?: number;
        totalReplacements?: number;
        completedInChunks?: number;
        results?: Array<{
          success: boolean;
          nodeId: string;
          error?: string;
          originalText?: string;
          translatedText?: string;
        }>;
      }

      const typedResult = result as TextReplaceResult;

      // Format the results for display
      const success = typedResult.replacementsApplied && typedResult.replacementsApplied > 0;
      const progressText = `
      Text replacement completed:
      - ${typedResult.replacementsApplied || 0} of ${totalToProcess} successfully updated
      - ${typedResult.replacementsFailed || 0} failed
      - Processed in ${typedResult.completedInChunks || 1} batches
      `;

      // Detailed results
      const detailedResults = typedResult.results || [];
      const failedResults = detailedResults.filter(item => !item.success);

      // Create the detailed part of the response
      let detailedResponse = "";
      if (failedResults.length > 0) {
        detailedResponse = `\n\nNodes that failed:\n${failedResults.map(item =>
          `- ${item.nodeId}: ${item.error || "Unknown error"}`
        ).join('\n')}`;
      }

      return {
        content: [
          initialStatus,
          {
            type: "text" as const,
            text: progressText + detailedResponse,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error setting multiple text contents: ${error instanceof Error ? error.message : String(error)
              }`,
          },
        ],
      };
    }
  }
);

// Set Layout Mode Tool
server.tool(
  "set_layout_mode",
  "Set the layout mode and wrap behavior of a frame in Figma",
  {
    nodeId: z.string().describe("The ID of the frame to modify"),
    layoutMode: z.enum(["NONE", "HORIZONTAL", "VERTICAL"]).describe("Layout mode for the frame"),
    layoutWrap: z.enum(["NO_WRAP", "WRAP"]).optional().describe("Whether the auto-layout frame wraps its children")
  },
  async ({ nodeId, layoutMode, layoutWrap }: any) => {
    try {
      const result = await sendCommandToFigma("set_layout_mode", {
        nodeId,
        layoutMode,
        layoutWrap: layoutWrap || "NO_WRAP"
      });
      const typedResult = result as { name: string };
      return {
        content: [
          {
            type: "text",
            text: `Set layout mode of frame "${typedResult.name}" to ${layoutMode}${layoutWrap ? ` with ${layoutWrap}` : ''}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error setting layout mode: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  }
);

// Set Padding Tool
server.tool(
  "set_padding",
  "Set padding values for an auto-layout frame in Figma",
  {
    nodeId: z.string().describe("The ID of the frame to modify"),
    paddingTop: z.number().optional().describe("Top padding value"),
    paddingRight: z.number().optional().describe("Right padding value"),
    paddingBottom: z.number().optional().describe("Bottom padding value"),
    paddingLeft: z.number().optional().describe("Left padding value"),
  },
  async ({ nodeId, paddingTop, paddingRight, paddingBottom, paddingLeft }: any) => {
    try {
      const result = await sendCommandToFigma("set_padding", {
        nodeId,
        paddingTop,
        paddingRight,
        paddingBottom,
        paddingLeft,
      });
      const typedResult = result as { name: string };

      // Create a message about which padding values were set
      const paddingMessages = [];
      if (paddingTop !== undefined) paddingMessages.push(`top: ${paddingTop}`);
      if (paddingRight !== undefined) paddingMessages.push(`right: ${paddingRight}`);
      if (paddingBottom !== undefined) paddingMessages.push(`bottom: ${paddingBottom}`);
      if (paddingLeft !== undefined) paddingMessages.push(`left: ${paddingLeft}`);

      const paddingText = paddingMessages.length > 0
        ? `padding (${paddingMessages.join(', ')})`
        : "padding";

      return {
        content: [
          {
            type: "text",
            text: `Set ${paddingText} for frame "${typedResult.name}"`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error setting padding: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  }
);

// Set Axis Align Tool
server.tool(
  "set_axis_align",
  "Set primary and counter axis alignment for an auto-layout frame in Figma",
  {
    nodeId: z.string().describe("The ID of the frame to modify"),
    primaryAxisAlignItems: z
      .enum(["MIN", "MAX", "CENTER", "SPACE_BETWEEN"])
      .optional()
      .describe("Primary axis alignment (MIN/MAX = left/right in horizontal, top/bottom in vertical). Note: When set to SPACE_BETWEEN, itemSpacing will be ignored as children will be evenly spaced."),
    counterAxisAlignItems: z
      .enum(["MIN", "MAX", "CENTER", "BASELINE"])
      .optional()
      .describe("Counter axis alignment (MIN/MAX = top/bottom in horizontal, left/right in vertical)")
  },
  async ({ nodeId, primaryAxisAlignItems, counterAxisAlignItems }: any) => {
    try {
      const result = await sendCommandToFigma("set_axis_align", {
        nodeId,
        primaryAxisAlignItems,
        counterAxisAlignItems
      });
      const typedResult = result as { name: string };

      // Create a message about which alignments were set
      const alignMessages = [];
      if (primaryAxisAlignItems !== undefined) alignMessages.push(`primary: ${primaryAxisAlignItems}`);
      if (counterAxisAlignItems !== undefined) alignMessages.push(`counter: ${counterAxisAlignItems}`);

      const alignText = alignMessages.length > 0
        ? `axis alignment (${alignMessages.join(', ')})`
        : "axis alignment";

      return {
        content: [
          {
            type: "text",
            text: `Set ${alignText} for frame "${typedResult.name}"`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error setting axis alignment: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  }
);

// Set Layout Sizing Tool
server.tool(
  "set_layout_sizing",
  "Set horizontal and vertical sizing modes for an auto-layout frame in Figma",
  {
    nodeId: z.string().describe("The ID of the frame to modify"),
    layoutSizingHorizontal: z
      .enum(["FIXED", "HUG", "FILL"])
      .optional()
      .describe("Horizontal sizing mode (HUG for frames/text only, FILL for auto-layout children only)"),
    layoutSizingVertical: z
      .enum(["FIXED", "HUG", "FILL"])
      .optional()
      .describe("Vertical sizing mode (HUG for frames/text only, FILL for auto-layout children only)")
  },
  async ({ nodeId, layoutSizingHorizontal, layoutSizingVertical }: any) => {
    try {
      const result = await sendCommandToFigma("set_layout_sizing", {
        nodeId,
        layoutSizingHorizontal,
        layoutSizingVertical
      });
      const typedResult = result as { name: string };

      // Create a message about which sizing modes were set
      const sizingMessages = [];
      if (layoutSizingHorizontal !== undefined) sizingMessages.push(`horizontal: ${layoutSizingHorizontal}`);
      if (layoutSizingVertical !== undefined) sizingMessages.push(`vertical: ${layoutSizingVertical}`);

      const sizingText = sizingMessages.length > 0
        ? `layout sizing (${sizingMessages.join(', ')})`
        : "layout sizing";

      return {
        content: [
          {
            type: "text",
            text: `Set ${sizingText} for frame "${typedResult.name}"`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error setting layout sizing: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  }
);

// Set Item Spacing Tool
server.tool(
  "set_item_spacing",
  "Set distance between children in an auto-layout frame",
  {
    nodeId: z.string().describe("The ID of the frame to modify"),
    itemSpacing: z.number().optional().describe("Distance between children. Note: This value will be ignored if primaryAxisAlignItems is set to SPACE_BETWEEN."),
    counterAxisSpacing: z.number().optional().describe("Distance between wrapped rows/columns. Only works when layoutWrap is set to WRAP.")
  },
  async ({ nodeId, itemSpacing, counterAxisSpacing }: any) => {
    try {
      const params: any = { nodeId };
      if (itemSpacing !== undefined) params.itemSpacing = itemSpacing;
      if (counterAxisSpacing !== undefined) params.counterAxisSpacing = counterAxisSpacing;

      const result = await sendCommandToFigma("set_item_spacing", params);
      const typedResult = result as { name: string, itemSpacing?: number, counterAxisSpacing?: number };

      let message = `Updated spacing for frame "${typedResult.name}":`;
      if (itemSpacing !== undefined) message += ` itemSpacing=${itemSpacing}`;
      if (counterAxisSpacing !== undefined) message += ` counterAxisSpacing=${counterAxisSpacing}`;

      return {
        content: [
          {
            type: "text",
            text: message,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error setting spacing: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  }
);

// A tool to get Figma Prototyping Reactions from multiple nodes
server.tool(
  "get_reactions",
  "Get Figma Prototyping Reactions from multiple nodes. CRITICAL: The output MUST be processed using the 'reaction_to_connector_strategy' prompt IMMEDIATELY to generate parameters for connector lines via the 'create_connections' tool.",
  {
    nodeIds: z.array(z.string()).describe("Array of node IDs to get reactions from"),
  },
  async ({ nodeIds }: any) => {
    try {
      const result = await sendCommandToFigma("get_reactions", { nodeIds });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result)
          },
          {
            type: "text",
            text: "IMPORTANT: You MUST now use the reaction data above and follow the `reaction_to_connector_strategy` prompt to prepare the parameters for the `create_connections` tool call. This is a required next step."
          }
        ],
        followUp: {
          type: "prompt",
          prompt: "reaction_to_connector_strategy",
        },
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error getting reactions: ${error instanceof Error ? error.message : String(error)
              }`,
          },
        ],
      };
    }
  }
);

// Create Connectors Tool
server.tool(
  "set_default_connector",
  "Set a copied connector node as the default connector",
  {
    connectorId: z.string().optional().describe("The ID of the connector node to set as default")
  },
  async ({ connectorId }: any) => {
    try {
      const result = await sendCommandToFigma("set_default_connector", {
        connectorId
      });

      return {
        content: [
          {
            type: "text",
            text: `Default connector set: ${JSON.stringify(result)}`
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error setting default connector: ${error instanceof Error ? error.message : String(error)}`
          }
        ]
      };
    }
  }
);

// Connect Nodes Tool
server.tool(
  "create_connections",
  "Create connections between nodes using the default connector style",
  {
    connections: z.array(z.object({
      startNodeId: z.string().describe("ID of the starting node"),
      endNodeId: z.string().describe("ID of the ending node"),
      text: z.string().optional().describe("Optional text to display on the connector")
    })).describe("Array of node connections to create")
  },
  async ({ connections }: any) => {
    try {
      if (!connections || connections.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: "No connections provided"
            }
          ]
        };
      }

      const result = await sendCommandToFigma("create_connections", {
        connections
      });

      return {
        content: [
          {
            type: "text",
            text: `Created ${connections.length} connections: ${JSON.stringify(result)}`
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error creating connections: ${error instanceof Error ? error.message : String(error)}`
          }
        ]
      };
    }
  }
);

// Set Focus Tool
server.tool(
  "set_focus",
  "Set focus on a specific node in Figma by selecting it and scrolling viewport to it",
  {
    nodeId: z.string().describe("The ID of the node to focus on"),
  },
  async ({ nodeId }: any) => {
    try {
      const result = await sendCommandToFigma("set_focus", { nodeId });
      const typedResult = result as { name: string; id: string };
      return {
        content: [
          {
            type: "text",
            text: `Focused on node "${typedResult.name}" (ID: ${typedResult.id})`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error setting focus: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  }
);

// Set Selections Tool
server.tool(
  "set_selections",
  "Set selection to multiple nodes in Figma and scroll viewport to show them",
  {
    nodeIds: z.array(z.string()).describe("Array of node IDs to select"),
  },
  async ({ nodeIds }: any) => {
    try {
      const result = await sendCommandToFigma("set_selections", { nodeIds });
      const typedResult = result as { selectedNodes: Array<{ name: string; id: string }>; count: number };
      return {
        content: [
          {
            type: "text",
            text: `Selected ${typedResult.count} nodes: ${typedResult.selectedNodes.map(node => `"${node.name}" (${node.id})`).join(', ')}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error setting selections: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  }
);

// Create Heatmap Tool
server.tool(
  "create_heatmap",
  "This tool is for creating heatmap and ALWAYS call this tool when creating heatmap",
  {},
  async () => {
    try {
      const result = await sendCommandToFigma("create_heatmap", {});
      return {
        content: [
          {
            type: "text" as const,
            text: `Heatmap creation initiated in Figma`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error creating heatmap: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  }
);


// Define command types and parameters
type FigmaCommand =
  | "get_document_info"
  | "get_selection"
  | "get_node_info"
  | "get_nodes_info"
  | "read_my_design"
  | "create_rectangle"
  | "create_ellipse"
  | "create_vector"
  | "create_frame"
  | "create_text"
  | "set_fill_color"
  | "set_stroke_color"
  | "move_node"
  | "resize_node"
  | "delete_node"
  | "delete_multiple_nodes"
  | "get_styles"
  | "get_local_components"
  | "create_component_instance"
  | "get_instance_overrides"
  | "set_instance_overrides"
  | "export_node_as_image"
  | "insert_image_data"
  | "insert_image_from_file"
  | "insert_website_screenshot"
  | "join"
  | "set_corner_radius"
  | "clone_node"
  | "set_text_content"
  | "scan_text_nodes"
  | "set_multiple_text_contents"
  | "get_annotations"
  | "set_annotation"
  | "set_multiple_annotations"
  | "scan_nodes_by_types"
  | "set_layout_mode"
  | "set_padding"
  | "set_axis_align"
  | "set_layout_sizing"
  | "set_item_spacing"
  | "get_reactions"
  | "set_default_connector"
  | "create_connections"
  | "set_focus"
  | "set_selections"
  | "detach_instance"
  | "create_heatmap"
  | "create_table";

type CommandParams = {
  get_document_info: Record<string, never>;
  get_selection: Record<string, never>;
  get_node_info: { nodeId: string };
  get_nodes_info: { nodeIds: string[] };
  create_rectangle: {
    x: number;
    y: number;
    width: number;
    height: number;
    name?: string;
    parentId?: string;
    fillColor?: { r: number; g: number; b: number; a?: number };
    strokeColor?: { r: number; g: number; b: number; a?: number };
    strokeWeight?: number;
    cornerRadius?: number;
  };
  create_ellipse: {
    x: number;
    y: number;
    width?: number;
    height?: number;
    radius?: number;
    name?: string;
    parentId?: string;
    fillColor?: { r: number; g: number; b: number; a?: number };
    strokeColor?: { r: number; g: number; b: number; a?: number };
    strokeWeight?: number;
  };
  create_vector: {
    x: number;
    y: number;
    vectorPaths: Array<{
      windingRule?: "EVENODD" | "NONZERO";
      data: string;
    }>;
    name?: string;
    parentId?: string;
    fillColor?: { r: number; g: number; b: number; a?: number };
    strokeColor?: { r: number; g: number; b: number; a?: number };
    strokeWeight?: number;
  };
  create_frame: {
    x: number;
    y: number;
    width: number;
    height: number;
    name?: string;
    parentId?: string;
    fillColor?: { r: number; g: number; b: number; a?: number };
    strokeColor?: { r: number; g: number; b: number; a?: number };
    strokeWeight?: number;
  };
  create_text: {
    x: number;
    y: number;
    text: string;
    fontSize?: number;
    fontWeight?: number;
    fontColor?: { r: number; g: number; b: number; a?: number };
    name?: string;
    parentId?: string;
  };
  set_fill_color: {
    nodeId: string;
    r: number;
    g: number;
    b: number;
    a?: number;
  };
  set_stroke_color: {
    nodeId: string;
    r: number;
    g: number;
    b: number;
    a?: number;
    weight?: number;
  };
  move_node: {
    nodeId: string;
    x: number;
    y: number;
  };
  resize_node: {
    nodeId: string;
    width: number;
    height: number;
  };
  delete_node: {
    nodeId: string;
  };
  delete_multiple_nodes: {
    nodeIds: string[];
  };
  get_styles: Record<string, never>;
  get_local_components: Record<string, never>;
  get_team_components: Record<string, never>;
  create_component_instance: {
    componentKey: string;
    x: number;
    y: number;
  };
  get_instance_overrides: {
    instanceNodeId: string | null;
  };
  set_instance_overrides: {
    targetNodeIds: string[];
    sourceInstanceId: string;
  };
  export_node_as_image: {
    nodeId: string;
    format?: "PNG" | "JPG" | "SVG" | "PDF";
    scale?: number;
  };
  insert_image_data: {
    imageData: string;
    frameId?: string;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
  };
  insert_image_from_file: {
    filePath: string;
    frameId?: string;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
  };
  insert_website_screenshot: {
    website: string;
    frameId?: string;
    useSelectedFrame?: boolean;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    maxSizeKB?: number;
  };
  execute_code: {
    code: string;
  };
  join: {
    channel: string;
  };
  set_corner_radius: {
    nodeId: string;
    radius: number;
    corners?: boolean[];
  };
  clone_node: {
    nodeId: string;
    x?: number;
    y?: number;
    parentId?: string;
    insertAtIndex?: number;
  };
  set_text_content: {
    nodeId: string;
    text: string;
  };
  scan_text_nodes: {
    nodeId: string;
    useChunking: boolean;
    chunkSize: number;
  };
  set_multiple_text_contents: {
    nodeId: string;
    text: Array<{ nodeId: string; text: string }>;
  };
  get_annotations: {
    nodeId?: string;
    includeCategories?: boolean;
  };
  set_annotation: {
    nodeId: string;
    annotationId?: string;
    labelMarkdown: string;
    categoryId?: string;
    properties?: Array<{ type: string }>;
  };
  set_multiple_annotations: SetMultipleAnnotationsParams;
  scan_nodes_by_types: {
    nodeId: string;
    types: Array<string>;
  };
  get_reactions: { nodeIds: string[] };
  set_default_connector: {
    connectorId?: string | undefined;
  };
  create_connections: {
    connections: Array<{
      startNodeId: string;
      endNodeId: string;
      text?: string;
    }>;
  };
  set_focus: {
    nodeId: string;
  };
  set_selections: {
    nodeIds: string[];
  };
  detach_instance: {
    nodeId: string;
  };
  create_heatmap: Record<string, never>;
  create_table: {
    rows: number;
    columns: number;
    textData: string[][];
    x?: number;
    y?: number;
    cellWidth?: number;
    cellHeight?: number;
    name?: string;
    fontSize?: number;
  };

};

// Helper function to compress and insert large images
async function compressAndInsertImage(
  imagePath: string,
  frameId: string | undefined,
  startX: number,
  startY: number,
  targetWidth?: number,
  targetHeight?: number,
  maxSizeKB: number = 800
) {
  try {
    logger.info("Starting image compression and insertion process...");

    // Read the original image
    const imageBuffer = readFileSync(imagePath);
    const originalSizeKB = imageBuffer.length / 1024;

    logger.info(`Original image size: ${originalSizeKB.toFixed(2)} KB`);

    // Compress the image
    const compressedImage = await compressImageWithSharp(imagePath, maxSizeKB);

    logger.info(`Successfully compressed image to ${(compressedImage.length / 1024).toFixed(2)} KB`);

    // Insert the compressed image
    const result = await sendCommandToFigma("insert_image_data", {
      imageData: compressedImage.toString('base64'),
      frameId,
      x: startX,
      y: startY,
      width: targetWidth,
      height: targetHeight,
    });

    const typedResult = result as { nodeId: string; name: string; frameId: string; frameName: string; width: number; height: number };
    return {
      content: [
        {
          type: "text" as const,
          text: `Successfully inserted compressed image "${imagePath}" into frame "${typedResult.frameName}" with node ID: ${typedResult.nodeId}. Original size: ${originalSizeKB.toFixed(2)} KB, compressed to: ${(compressedImage.length / 1024).toFixed(2)} KB`,
        },
      ],
    };

  } catch (error) {
    return {
      content: [
        {
          type: "text" as const,
          text: `Error handling large image: ${error instanceof Error ? error.message : String(error)}. Image compression failed.`,
        },
      ],
    };
  }
}

// Helper function to compress image using Sharp
async function compressImageWithSharp(imagePath: string, maxSizeKB: number): Promise<Buffer> {
  try {
    // First, get the original image metadata to determine preprocessing strategy
    const metadata = await sharp(imagePath).metadata();
    const originalWidth = metadata.width || 800;
    const originalHeight = metadata.height || 600;
    const pixelCount = originalWidth * originalHeight;

    logger.info(`Original image: ${originalWidth}x${originalHeight} (${pixelCount} pixels, ${(pixelCount / 1000000).toFixed(1)}M pixels)`);

    let quality = 90;
    let scale = 1.0;
    let compressedBuffer: Buffer;

    // For extremely large images (>10M pixels), start with more aggressive preprocessing
    if (pixelCount > 10000000) { // 10M pixels
      logger.info(`Large image detected (${(pixelCount / 1000000).toFixed(1)}M pixels). Starting with aggressive preprocessing.`);
      scale = Math.min(0.5, Math.sqrt(maxSizeKB / 100)); // Start at 50% or calculated scale
      quality = 80; // Start with lower quality for large images
    }

    // Try different compression levels until we meet the size requirement
    do {
      const sharpInstance = sharp(imagePath);

      const targetWidth = Math.round(originalWidth * scale);
      const targetHeight = Math.round(originalHeight * scale);

      // Apply compression
      if (metadata.format === 'png') {
        compressedBuffer = await sharpInstance
          .resize(targetWidth, targetHeight, {
            withoutEnlargement: true,
            fit: 'inside'
          })
          .png({ quality, compressionLevel: 9 })
          .toBuffer();
      } else {
        // For JPEG and other formats
        compressedBuffer = await sharpInstance
          .resize(targetWidth, targetHeight, {
            withoutEnlargement: true,
            fit: 'inside'
          })
          .jpeg({ quality })
          .toBuffer();
      }

      const currentSizeKB = compressedBuffer.length / 1024;

      if (currentSizeKB <= maxSizeKB) {
        logger.info(`Successfully compressed image to ${currentSizeKB.toFixed(2)} KB (${targetWidth}x${targetHeight}) with quality ${quality} and scale ${(scale * 100).toFixed(0)}%`);
        return compressedBuffer;
      }

      // More aggressive reduction strategy for large images
      if (pixelCount > 5000000) { // 5M pixels - be more aggressive
        if (scale > 0.3) {
          scale = Math.max(0.3, scale - 0.2); // Reduce scale by 20% each time
          quality = Math.max(50, quality - 15); // Reduce quality more aggressively
        } else {
          quality = Math.max(30, quality - 10); // Continue reducing quality
        }
      } else {
        // Original strategy for smaller images
        if (quality > 60) {
          quality -= 10;
        } else if (scale > 0.5) {
          scale -= 0.1;
          quality = 90; // Reset quality when scaling down
        } else {
          quality -= 5;
        }
      }

    } while (quality > 10 && scale > 0.1); // Allow more aggressive scaling down to 10%

    // If we still can't compress enough, try converting to JPEG for better compression
    if (metadata.format === 'png' && pixelCount > 2000000) {
      logger.info(`PNG compression insufficient. Trying JPEG conversion for better compression.`);
      try {
        const jpegBuffer = await sharp(imagePath)
          .resize(Math.round(originalWidth * 0.6), Math.round(originalHeight * 0.6), {
            withoutEnlargement: true,
            fit: 'inside'
          })
          .jpeg({ quality: 70 })
          .toBuffer();

        const jpegSizeKB = jpegBuffer.length / 1024;
        if (jpegSizeKB <= maxSizeKB) {
          logger.info(`Successfully converted PNG to JPEG: ${jpegSizeKB.toFixed(2)} KB`);
          return jpegBuffer;
        }
      } catch (jpegError) {
        logger.warn(`JPEG conversion failed: ${jpegError}`);
      }
    }

    // If we still can't compress enough, return the last attempt
    const finalSizeKB = compressedBuffer!.length / 1024;
    logger.warn(`Could not compress image below ${maxSizeKB} KB. Final size: ${finalSizeKB.toFixed(2)} KB (${Math.round(originalWidth * scale)}x${Math.round(originalHeight * scale)})`);
    return compressedBuffer!;

  } catch (error) {
    logger.error(`Image compression failed: ${error}`);
    throw new Error(`Failed to compress image: ${error instanceof Error ? error.message : String(error)}`);
  }
}



// Helper function to process Figma node responses
function processFigmaNodeResponse(result: unknown): any {
  if (!result || typeof result !== "object") {
    return result;
  }

  // Check if this looks like a node response
  const resultObj = result as Record<string, unknown>;
  if ("id" in resultObj && typeof resultObj.id === "string") {
    // It appears to be a node response, log the details
    console.info(
      `Processed Figma node: ${resultObj.name || "Unknown"} (ID: ${resultObj.id
      })`
    );

    if ("x" in resultObj && "y" in resultObj) {
      console.debug(`Node position: (${resultObj.x}, ${resultObj.y})`);
    }

    if ("width" in resultObj && "height" in resultObj) {
      console.debug(`Node dimensions: ${resultObj.width}×${resultObj.height}`);
    }
  }

  return result;
}

// Update the connectToFigma function
function connectToFigma(port: number = 3055) {
  // If already connected, do nothing
  if (ws && ws.readyState === WebSocket.OPEN) {
    logger.info('Already connected to Figma');
    return;
  }

  const wsUrl = serverUrl === 'localhost' ? `${WS_URL}:${port}` : WS_URL;
  logger.info(`Connecting to Figma socket server at ${wsUrl}...`);
  ws = new WebSocket(wsUrl);

  ws.on('open', () => {
    logger.info('Connected to Figma socket server');
    // Reset channel on new connection
    currentChannel = null;
  });

  ws.on("message", (data: any) => {
    try {
      // Define a more specific type with an index signature to allow any property access
      interface ProgressMessage {
        message: FigmaResponse | any;
        type?: string;
        id?: string;
        [key: string]: any; // Allow any other properties
      }

      const json = JSON.parse(data) as ProgressMessage;

      // Handle progress updates
      if (json.type === 'progress_update') {
        const progressData = json.message.data as CommandProgressUpdate;
        const requestId = json.id || '';

        if (requestId && pendingRequests.has(requestId)) {
          const request = pendingRequests.get(requestId)!;

          // Update last activity timestamp
          request.lastActivity = Date.now();

          // Reset the timeout to prevent timeouts during long-running operations
          clearTimeout(request.timeout);

          // Create a new timeout
          request.timeout = setTimeout(() => {
            if (pendingRequests.has(requestId)) {
              logger.error(`Request ${requestId} timed out after extended period of inactivity`);
              pendingRequests.delete(requestId);
              request.reject(new Error('Request to Figma timed out'));
            }
          }, 60000); // 60 second timeout for inactivity

          // Log progress
          logger.info(`Progress update for ${progressData.commandType}: ${progressData.progress}% - ${progressData.message}`);

          // For completed updates, we could resolve the request early if desired
          if (progressData.status === 'completed' && progressData.progress === 100) {
            // Optionally resolve early with partial data
            // request.resolve(progressData.payload);
            // pendingRequests.delete(requestId);

            // Instead, just log the completion, wait for final result from Figma
            logger.info(`Operation ${progressData.commandType} completed, waiting for final result`);
          }
        }
        return;
      }

      // Handle regular responses
      const myResponse = json.message;
      logger.debug(`Received message: ${JSON.stringify(myResponse)}`);
      logger.log('myResponse' + JSON.stringify(myResponse));

      // Handle response to a request
      if (
        myResponse.id &&
        pendingRequests.has(myResponse.id) &&
        myResponse.result
      ) {
        const request = pendingRequests.get(myResponse.id)!;
        clearTimeout(request.timeout);

        if (myResponse.error) {
          logger.error(`Error from Figma: ${myResponse.error}`);
          request.reject(new Error(myResponse.error));
        } else {
          if (myResponse.result) {
            request.resolve(myResponse.result);
          }
        }

        pendingRequests.delete(myResponse.id);
      } else {
        // Handle broadcast messages or events
        logger.info(`Received broadcast message: ${JSON.stringify(myResponse)}`);
      }
    } catch (error) {
      logger.error(`Error parsing message: ${error instanceof Error ? error.message : String(error)}`);
    }
  });

  ws.on('error', (error) => {
    logger.error(`Socket error: ${error}`);
  });

  ws.on('close', () => {
    logger.info('Disconnected from Figma socket server');
    ws = null;

    // Reject all pending requests
    for (const [id, request] of pendingRequests.entries()) {
      clearTimeout(request.timeout);
      request.reject(new Error("Connection closed"));
      pendingRequests.delete(id);
    }

    // Attempt to reconnect
    logger.info('Attempting to reconnect in 2 seconds...');
    setTimeout(() => connectToFigma(port), 2000);
  });
}

// Function to join a channel
async function joinChannel(channelName: string): Promise<void> {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    throw new Error("Not connected to Figma");
  }

  try {
    await sendCommandToFigma("join", { channel: channelName });
    currentChannel = channelName;
    logger.info(`Joined channel: ${channelName}`);
  } catch (error) {
    logger.error(`Failed to join channel: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

// Function to send commands to Figma
function sendCommandToFigma(
  command: FigmaCommand,
  params: unknown = {},
  timeoutMs: number = 30000
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    // If not connected, try to connect first
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      connectToFigma();
      reject(new Error("Not connected to Figma. Attempting to connect..."));
      return;
    }

    // Check if we need a channel for this command
    const requiresChannel = command !== "join";
    if (requiresChannel && !currentChannel) {
      reject(new Error("Must join a channel before sending commands"));
      return;
    }

    const id = uuidv4();
    const request = {
      id,
      type: command === "join" ? "join" : "message",
      ...(command === "join"
        ? { channel: (params as any).channel }
        : { channel: currentChannel }),
      message: {
        id,
        command,
        params: {
          ...(params as any),
          commandId: id, // Include the command ID in params
        },
      },
    };

    // Set timeout for request
    const timeout = setTimeout(() => {
      if (pendingRequests.has(id)) {
        pendingRequests.delete(id);
        logger.error(`Request ${id} to Figma timed out after ${timeoutMs / 1000} seconds`);
        reject(new Error('Request to Figma timed out'));
      }
    }, timeoutMs);

    // Store the promise callbacks to resolve/reject later
    pendingRequests.set(id, {
      resolve,
      reject,
      timeout,
      lastActivity: Date.now()
    });

    // Send the request
    logger.info(`Sending command to Figma: ${command}`);
    logger.debug(`Request details: ${JSON.stringify(request)}`);
    ws.send(JSON.stringify(request));
  });
}

// Update the join_channel tool
server.tool(
  "join_channel",
  "Join a specific channel to communicate with Figma",
  {
    channel: z.string().describe("The name of the channel to join").default(""),
  },
  async ({ channel }: any) => {
    try {
      if (!channel) {
        // If no channel provided, ask the user for input
        return {
          content: [
            {
              type: "text",
              text: "Please provide a channel name to join:",
            },
          ],
          followUp: {
            tool: "join_channel",
            description: "Join the specified channel",
          },
        };
      }

      await joinChannel(channel);
      return {
        content: [
          {
            type: "text",
            text: `Successfully joined channel: ${channel}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error joining channel: ${error instanceof Error ? error.message : String(error)
              }`,
          },
        ],
      };
    }
  }
);

// Start the server
async function main() {
  try {
    // Try to connect to Figma socket server
    connectToFigma();
  } catch (error) {
    logger.warn(`Could not connect to Figma initially: ${error instanceof Error ? error.message : String(error)}`);
    logger.warn('Will try to connect when the first command is sent');
  }

  // Start the MCP server with stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info('FigmaMCP server running on stdio');
}

// Run the server
main().catch(error => {
  logger.error(`Error starting FigmaMCP server: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});



