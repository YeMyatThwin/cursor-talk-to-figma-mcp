import { z } from "zod";

// Define all prompts in an organized structure similar to mcp.ts
const figmaPrompts = {
  design_strategy: {
    title: "Best practices for working with Figma designs",
    description: "Comprehensive design strategy for web and mobile with automatic frame-based positioning",
    inputSchema: z.object({}),
    handler: async () => {
      return {
        messages: [
          {
            role: "assistant" as const,
            content: {
              type: "text" as const,
              text: `When working with Figma designs, follow these best practices:

1. Start with Document Structure:
   - First use get_document_info() to understand the current document
   - Plan your layout hierarchy before creating elements
   - Create a main container frame for each screen/section

2. Naming Conventions:
   - Use descriptive, semantic names for all elements
   - Follow a consistent naming pattern (e.g., "Login Screen", "Logo Container", "Email Input")
   - Group related elements with meaningful names

3. Layout Hierarchy:
   - Create parent frames first, then add child elements
   - For forms/login screens:
     * Start with the main screen container frame
     * Create a logo container at the top
     * Group input fields in their own containers
     * Place action buttons (login, submit) after inputs
     * Add secondary elements (forgot password, signup links) last

4. Input Fields Structure:
   - Create a container frame for each input field
   - Include a label text above or inside the input
   - Group related inputs (e.g., username/password) together

5. Element Creation:
   - Use create_frame() for containers and input fields
   - Use create_text() for labels, buttons text, and links
   - Set appropriate colors and styles:
     * Use fillColor for backgrounds
     * Use strokeColor for borders
     * Set proper fontWeight for different text elements

6. Mofifying existing elements:
  - use set_text_content() to modify text content.

7. Visual Hierarchy:
   - Position elements in logical reading order (top to bottom)
   - Maintain consistent spacing between elements
   - Use appropriate font sizes for different text types:
     * Larger for headings/welcome text
     * Medium for input labels
     * Standard for button text
     * Smaller for helper text/links

8. Best Practices:
   - Verify each creation with get_node_info()
   - Use parentId to maintain proper hierarchy
   - Group related elements together in frames
   - Keep consistent spacing and alignment

Example Login Screen Structure:
- Login Screen (main frame)
  - Logo Container (frame)
    - Logo (image/text)
  - Welcome Text (text)
  - Input Container (frame)
    - Email Input (frame)
      - Email Label (text)
      - Email Field (frame)
    - Password Input (frame)
      - Password Label (text)
      - Password Field (frame)
  - Login Button (frame)
    - Button Text (text)
  - Helper Links (frame)
    - Forgot Password (text)
    - Don't have account (text)`,
            },
          },
        ],
        description: "Best practices for working with Figma designs",
      };
    }
  },

  read_design_strategy: {
    title: "Best practices for reading Figma designs",
    description: "Best practices for reading Figma designs",
    inputSchema: z.object({}),
    handler: async () => {
      return {
        messages: [
          {
            role: "assistant" as const,
            content: {
              type: "text" as const,
              text: `When reading Figma designs, follow these best practices:

1. Start with selection:
   - First use read_my_design() to understand the current selection
   - If no selection ask user to select single or multiple nodes
`,
            },
          },
        ],
        description: "Best practices for reading Figma designs",
      };
    }
  },

  text_replacement_strategy: {
    title: "Systematic approach for replacing text in Figma designs",
    description: "Systematic approach for replacing text in Figma designs",
    inputSchema: z.object({}),
    handler: async () => {
      return {
        messages: [
          {
            role: "assistant" as const,
            content: {
              type: "text" as const,
              text: `# Intelligent Text Replacement Strategy

## 1. Analyze Design & Identify Structure
- Scan text nodes to understand the overall structure of the design
- Use AI pattern recognition to identify logical groupings:
  * Tables (rows, columns, headers, cells)
  * Lists (items, headers, nested lists)
  * Card groups (similar cards with recurring text fields)
  * Forms (labels, input fields, validation text)
  * Navigation (menu items, breadcrumbs)
\`\`\`
scan_text_nodes(nodeId: "node-id")
get_node_info(nodeId: "node-id")  // optional
\`\`\`

## 2. Strategic Chunking for Complex Designs
- Divide replacement tasks into logical content chunks based on design structure
- Use one of these chunking strategies that best fits the design:
  * **Structural Chunking**: Table rows/columns, list sections, card groups
  * **Spatial Chunking**: Top-to-bottom, left-to-right in screen areas
  * **Semantic Chunking**: Content related to the same topic or functionality
  * **Component-Based Chunking**: Process similar component instances together

## 3. Progressive Replacement with Verification
- Create a safe copy of the node for text replacement
- Replace text chunk by chunk with continuous progress updates
- After each chunk is processed:
  * Export that section as a small, manageable image
  * Verify text fits properly and maintain design integrity
  * Fix issues before proceeding to the next chunk

\`\`\`
// Clone the node to create a safe copy
clone_node(nodeId: "selected-node-id", x: [new-x], y: [new-y], parentId: "optional-parent-id")

// Replace text chunk by chunk
set_multiple_text_contents(
  nodeId: "parent-node-id", 
  text: [
    { nodeId: "node-id-1", text: "New text 1" },
    // More nodes in this chunk...
  ]
)

// Verify chunk with small, targeted image exports
export_node_as_image(nodeId: "chunk-node-id", format: "PNG", scale: 0.5)
\`\`\`

## 4. Intelligent Handling for Table Data
- For tabular content:
  * Process one row or column at a time
  * Maintain alignment and spacing between cells
  * Consider conditional formatting based on cell content
  * Preserve header/data relationships

## 5. Smart Text Adaptation
- Adaptively handle text based on container constraints:
  * Auto-detect space constraints and adjust text length
  * Apply line breaks at appropriate linguistic points
  * Maintain text hierarchy and emphasis
  * Consider font scaling for critical content that must fit

## 6. Progressive Feedback Loop
- Establish a continuous feedback loop during replacement:
  * Real-time progress updates (0-100%)
  * Small image exports after each chunk for verification
  * Issues identified early and resolved incrementally
  * Quick adjustments applied to subsequent chunks

## 7. Final Verification & Context-Aware QA
- After all chunks are processed:
  * Export the entire design at reduced scale for final verification
  * Check for cross-chunk consistency issues
  * Verify proper text flow between different sections
  * Ensure design harmony across the full composition

## 8. Chunk-Specific Export Scale Guidelines
- Scale exports appropriately based on chunk size:
  * Small chunks (1-5 elements): scale 1.0
  * Medium chunks (6-20 elements): scale 0.7
  * Large chunks (21-50 elements): scale 0.5
  * Very large chunks (50+ elements): scale 0.3
  * Full design verification: scale 0.2

## Sample Chunking Strategy for Common Design Types

### Tables
- Process by logical rows (5-10 rows per chunk)
- Alternative: Process by column for columnar analysis
- Tip: Always include header row in first chunk for reference

### Card Lists
- Group 3-5 similar cards per chunk
- Process entire cards to maintain internal consistency
- Verify text-to-image ratio within cards after each chunk

### Forms
- Group related fields (e.g., "Personal Information", "Payment Details")
- Process labels and input fields together
- Ensure validation messages and hints are updated with their fields

### Navigation & Menus
- Process hierarchical levels together (main menu, submenu)
- Respect information architecture relationships
- Verify menu fit and alignment after replacement

## Best Practices
- **Preserve Design Intent**: Always prioritize design integrity
- **Structural Consistency**: Maintain alignment, spacing, and hierarchy
- **Visual Feedback**: Verify each chunk visually before proceeding
- **Incremental Improvement**: Learn from each chunk to improve subsequent ones
- **Balance Automation & Control**: Let AI handle repetitive replacements but maintain oversight
- **Respect Content Relationships**: Keep related content consistent across chunks

Remember that text is never just text—it's a core design element that must work harmoniously with the overall composition. This chunk-based strategy allows you to methodically transform text while maintaining design integrity.`,
            },
          },
        ],
        description: "Systematic approach for replacing text in Figma designs",
      };
    }
  },

  annotation_conversion_strategy: {
    title: "Strategy for converting manual annotations to Figma's native annotations",
    description: "Strategy for converting manual annotations to Figma's native annotations",
    inputSchema: z.object({}),
    handler: async () => {
      return {
        messages: [
          {
            role: "assistant" as const,
            content: {
              type: "text" as const,
              text: `# Automatic Annotation Conversion
            
## Process Overview

The process of converting manual annotations (numbered/alphabetical indicators with connected descriptions) to Figma's native annotations:

1. Get the selected frame/component that contains annotations
2. Scan and collect all annotation text nodes
3. Scan target UI elements (components, instances, frames)
4. Match annotations to appropriate UI elements
5. Apply native Figma annotations

## Step 1: Get Selection and Initial Setup

First, get the selected frame or component that contains annotations:

\`\`\`typescript
// Get the selected frame/component
const selection = await get_selection();
const selectedNodeId = selection[0].id

// Get available annotation categories for later use
const annotationData = await get_annotations({
  nodeId: selectedNodeId,
  includeCategories: true
});
const categories = annotationData.categories;
\`\`\`

## Step 2: Scan Annotation Text Nodes

Scan all text nodes to identify annotations and their descriptions:

\`\`\`typescript
// Get all text nodes in the selection
const textNodes = await scan_text_nodes({
  nodeId: selectedNodeId
});

// Filter and group annotation markers and descriptions

// Markers typically have these characteristics:
// - Short text content (usually single digit/letter)
// - Specific font styles (often bold)
// - Located in a container with "Marker" or "Dot" in the name
// - Have a clear naming pattern (e.g., "1", "2", "3" or "A", "B", "C")


// Identify description nodes
// Usually longer text nodes near markers or with matching numbers in path
  
\`\`\`

## Step 3: Scan Target UI Elements

Get all potential target elements that annotations might refer to:

\`\`\`typescript
// Scan for all UI elements that could be annotation targets
const targetNodes = await scan_nodes_by_types({
  nodeId: selectedNodeId,
  types: [
    "COMPONENT",
    "INSTANCE",
    "FRAME"
  ]
});
\`\`\`

## Step 4: Match Annotations to Targets

Match each annotation to its target UI element using these strategies in order of priority:

1. **Path-Based Matching**:
   - Look at the marker's parent container name in the Figma layer hierarchy
   - Remove any "Marker:" or "Annotation:" prefixes from the parent name
   - Find UI elements that share the same parent name or have it in their path
   - This works well when markers are grouped with their target elements

2. **Name-Based Matching**:
   - Extract key terms from the annotation description
   - Look for UI elements whose names contain these key terms
   - Consider both exact matches and semantic similarities
   - Particularly effective for form fields, buttons, and labeled components

3. **Proximity-Based Matching** (fallback):
   - Calculate the center point of the marker
   - Find the closest UI element by measuring distances to element centers
   - Consider the marker's position relative to nearby elements
   - Use this method when other matching strategies fail

Additional Matching Considerations:
- Give higher priority to matches found through path-based matching
- Consider the type of UI element when evaluating matches
- Take into account the annotation's context and content
- Use a combination of strategies for more accurate matching

## Step 5: Apply Native Annotations

Convert matched annotations to Figma's native annotations using batch processing:

\`\`\`typescript
// Prepare annotations array for batch processing
const annotationsToApply = Object.values(annotations).map(({ marker, description }) => {
  // Find target using multiple strategies
  const target = 
    findTargetByPath(marker, targetNodes) ||
    findTargetByName(description, targetNodes) ||
    findTargetByProximity(marker, targetNodes);
  
  if (target) {
    // Determine appropriate category based on content
    const category = determineCategory(description.characters, categories);

    // Determine appropriate additional annotationProperty based on content
    const annotationProperty = determineProperties(description.characters, target.type);
    
    return {
      nodeId: target.id,
      labelMarkdown: description.characters,
      categoryId: category.id,
      properties: annotationProperty
    };
  }
  return null;
}).filter(Boolean); // Remove null entries

// Apply annotations in batches using set_multiple_annotations
if (annotationsToApply.length > 0) {
  await set_multiple_annotations({
    nodeId: selectedNodeId,
    annotations: annotationsToApply
  });
}
\`\`\`


This strategy focuses on practical implementation based on real-world usage patterns, emphasizing the importance of handling various UI elements as annotation targets, not just text nodes.`
            },
          },
        ],
        description: "Strategy for converting manual annotations to Figma's native annotations",
      };
    }
  },

  swap_overrides_instances: {
    title: "Guide to swap instance overrides between instances",
    description: "Guide to swap instance overrides between instances",
    inputSchema: z.object({}),
    handler: async () => {
      return {
        messages: [
          {
            role: "assistant" as const,
            content: {
              type: "text" as const,
              text: `# Swap Component Instance and Override Strategy

## Overview
This strategy enables transferring content and property overrides from a source instance to one or more target instances in Figma, maintaining design consistency while reducing manual work.

## Step-by-Step Process

### 1. Selection Analysis
- Use \`get_selection()\` to identify the parent component or selected instances
- For parent components, scan for instances with \`scan_nodes_by_types({ nodeId: "parent-id", types: ["INSTANCE"] })\`
- Identify custom slots by name patterns (e.g. "Custom Slot*" or "Instance Slot") or by examining text content
- Determine which is the source instance (with content to copy) and which are targets (where to apply content)

### 2. Extract Source Overrides
- Use \`get_instance_overrides()\` to extract customizations from the source instance
- This captures text content, property values, and style overrides
- Command syntax: \`get_instance_overrides({ nodeId: "source-instance-id" })\`
- Look for successful response like "Got component information from [instance name]"

### 3. Apply Overrides to Targets
- Apply captured overrides using \`set_instance_overrides()\`
- Command syntax:
  \`\`\`
  set_instance_overrides({
    sourceInstanceId: "source-instance-id", 
    targetNodeIds: ["target-id-1", "target-id-2", ...]
  })
  \`\`\`

### 4. Verification
- Verify results with \`get_node_info()\` or \`read_my_design()\`
- Confirm text content and style overrides have transferred successfully

## Key Tips
- Always join the appropriate channel first with \`join_channel()\`
- When working with multiple targets, check the full selection with \`get_selection()\`
- Preserve component relationships by using instance overrides rather than direct text manipulation`,
            },
          },
        ],
        description: "Strategy for transferring overrides between component instances in Figma",
      };
    }
  },

  reaction_to_connector_strategy: {
    title: "Strategy for converting Figma prototype reactions to connector lines using the output of 'get_reactions'",
    description: "Strategy for converting Figma prototype reactions to connector lines using the output of 'get_reactions'",
    inputSchema: z.object({}),
    handler: async () => {
      return {
        messages: [
          {
            role: "assistant" as const,
            content: {
              type: "text" as const,
              text: `# Strategy: Convert Figma Prototype Reactions to Connector Lines

## Goal
Process the JSON output from the \`get_reactions\` tool to generate an array of connection objects suitable for the \`create_connections\` tool. This visually represents prototype flows as connector lines on the Figma canvas.

## Input Data
You will receive JSON data from the \`get_reactions\` tool. This data contains an array of nodes, each with potential reactions. A typical reaction object looks like this:
\`\`\`json
{
  "trigger": { "type": "ON_CLICK" },
  "action": {
    "type": "NAVIGATE",
    "destinationId": "destination-node-id",
    "navigationTransition": { ... },
    "preserveScrollPosition": false
  }
}
\`\`\`

## Step-by-Step Process

### 1. Preparation & Context Gathering
   - **Action:** Call \`read_my_design\` on the relevant node(s) to get context about the nodes involved (names, types, etc.). This helps in generating meaningful connector labels later.
   - **Action:** Call \`set_default_connector\` **without** the \`connectorId\` parameter.
   - **Check Result:** Analyze the response from \`set_default_connector\`.
     - If it confirms a default connector is already set (e.g., "Default connector is already set"), proceed to Step 2.
     - If it indicates no default connector is set (e.g., "No default connector set..."), you **cannot** proceed with \`create_connections\` yet. Inform the user they need to manually copy a connector from FigJam, paste it onto the current page, select it, and then you can run \`set_default_connector({ connectorId: "SELECTED_NODE_ID" })\` before attempting \`create_connections\`. **Do not proceed to Step 2 until a default connector is confirmed.**

### 2. Filter and Transform Reactions from \`get_reactions\` Output
   - **Iterate:** Go through the JSON array provided by \`get_reactions\`. For each node in the array:
     - Iterate through its \`reactions\` array.
   - **Filter:** Keep only reactions where the \`action\` meets these criteria:
     - Has a \`type\` that implies a connection (e.g., \`NAVIGATE\`, \`OPEN_OVERLAY\`, \`SWAP_OVERLAY\`). **Ignore** types like \`CHANGE_TO\`, \`CLOSE_OVERLAY\`, etc.
     - Has a valid \`destinationId\` property.
   - **Extract:** For each valid reaction, extract the following information:
     - \`sourceNodeId\`: The ID of the node the reaction belongs to (from the outer loop).
     - \`destinationNodeId\`: The value of \`action.destinationId\`.
     - \`actionType\`: The value of \`action.type\`.
     - \`triggerType\`: The value of \`trigger.type\`.

### 3. Generate Connector Text Labels
   - **For each extracted connection:** Create a concise, descriptive text label string.
   - **Combine Information:** Use the \`actionType\`, \`triggerType\`, and potentially the names of the source/destination nodes (obtained from Step 1's \`read_my_design\` or by calling \`get_node_info\` if necessary) to generate the label.
   - **Example Labels:**
     - If \`triggerType\` is "ON\_CLICK" and \`actionType\` is "NAVIGATE": "On click, navigate to [Destination Node Name]"
     - If \`triggerType\` is "ON\_DRAG" and \`actionType\` is "OPEN\_OVERLAY": "On drag, open [Destination Node Name] overlay"
   - **Keep it brief and informative.** Let this generated string be \`generatedText\`.

### 4. Prepare the \`connections\` Array for \`create_connections\`
   - **Structure:** Create a JSON array where each element is an object representing a connection.
   - **Format:** Each object in the array must have the following structure:
     \`\`\`json
     {
       "startNodeId": "sourceNodeId_from_step_2",
       "endNodeId": "destinationNodeId_from_step_2",
       "text": "generatedText_from_step_3"
     }
     \`\`\`
   - **Result:** This final array is the value you will pass to the \`connections\` parameter when calling the \`create_connections\` tool.

### 5. Execute Connection Creation
   - **Action:** Call the \`create_connections\` tool, passing the array generated in Step 4 as the \`connections\` argument.
   - **Verify:** Check the response from \`create_connections\` to confirm success or failure.

This detailed process ensures you correctly interpret the reaction data, prepare the necessary information, and use the appropriate tools to create the connector lines.`
            },
          },
        ],
        description: "Strategy for converting Figma prototype reactions to connector lines using the output of 'get_reactions'",
      };
    }
  },

  heatmap_strategy: {
    title: "Strategy for generating a heatmap overlay based on user interaction data",
    description: "Strategy for generating a heatmap overlay based on user interaction data",
    inputSchema: z.object({}),
    handler: async () => {
      return {
        messages: [
          {
            role: "assistant" as const,
            content: {
              type: "text" as const,
              text: `# Heatmap Creation Strategy
Overview:
- Create a separate overlay frame named "heatmap" with the exact same size and (x,y) coordinates as the selected frame, but do NOT put it inside the original frame (it must be a sibling / top-level frame at the same coordinates).
- Fill the "heatmap" frame with pure black and set opacity to 50% (0.5).
- Create colored rectangles with full round edges inside the "heatmap" frame to mark attention areas for interactive/content elements. All created rectangles (for heatmap) must follow exact color and opacity rules and must be positioned relative to the "heatmap" frame.
- Create figma comments for annotation for the references to the elements being highlighted.
 
Step 1 — Create the heatmap frame (same size & coordinates, outside original frame)
1. Get the selected frame:
\`\`\`javascript
const selection = await get_selectioan();
if (!selection || selection[0].type !== "FRAME") {
  throw new Error("Please select a single frame before running heatmap_strategy.");
}
const orig = selection[0];
\`\`\`
2. Create a sibling frame with the same x,y,width,height but NOT as a child of the original frame:
\`\`\`javascript
// Create a separate frame at the same absolute coordinates (not inside original)
const heatmapFrameId = await create_frame({
  x: orig.x,
  y: orig.y,
  width: orig.width,
  height: orig.height,
  name: "heatmap",
  layoutMode: "NONE", // free-positioning inside heatmap
  // Fill with black (r:0,g:0,b:0) and set alpha to 0.5
  fillColor: { r: 0, g: 0, b: 0, a: 0.5 }
});
\`\`\`
Notes:
- The frame must be a sibling (or top-level) node, not nested inside the original frame.
- The heatmap frame must visually overlap the original frame because it uses identical coordinates.
 
Step 2 — Place rectangles with full round edges inside the heatmap frame to represent attention
Rules for rectangles (strict):
- Opacity must be exactly 50% (0.5).
- Allowed colors ONLY (exact hex values):
  - Red: #FF0000  -> high attention (primary CTAs, main headlines, logos)
  - Amber: #FFC000 -> medium attention (navigation, secondary CTAs, section titles, interactive elements)
  - Green: #00FF00 -> low attention (descriptions, footer text, supporting content)
- Do NOT use any other colors, shades, tints, or alpha values (alpha must be exactly 0.5).
- Highlight ONLY interactive elements and content areas:
  - Buttons, text blocks, navigation items, logos, section titles, cards
- All rectangles must have full corner radius (rounded edges) to create a pill/capsule shape.
- Do NOT create rectangles for background areas, empty spaces, or whole-section coverings.
- Each rectangle must fully cover the UI element it represents. Use multiple smaller rectangles to cover complex shapes rather than one oversized rectangle that includes unrelated elements.
- All rectangles must be direct children of the "heatmap" frame.
- Coordinates for each rectangle must be calculated relative to the heatmap frame using:
  (rectangle_x = element_x - heatmap_x, rectangle_y = element_y - heatmap_y)
 
Step 3 — Create figma comments for annotations (ONLY if user specifically requests annotations)
- Skip this step unless the user explicitly asks for annotations or usability analysis
- If annotations are requested: For each rectangle created, use figma comments for annotation to the elements being highlighted. Compare the elements with 10 usability heuristics. cross check everything again one by one and make sure you provide all the references clearly within the frame
 
Step 4 — Comprehensive Usability Analysis and Improvement Suggestions (ONLY if user requests annotations)
- Skip this step unless the user explicitly asks for annotations or usability analysis
- If analysis is requested, for each annotated element, provide:
 
1. **Current State Analysis**: What the element currently does well/poorly
2. **Usability Heuristic Violations**: Specific heuristics that could be improved
3. **Concrete Improvement Suggestions**:
   - Specific alternative text for CTAs
   - Visual design recommendations
   - Positioning/prominence suggestions
   - User experience enhancements
 
4. **Priority Level**: Rank improvements by impact (High/Medium/Low)
 
5. **Examples**: Provide specific before/after suggestions:
   - "Instead of [current text] → [suggested text]"
   - "Consider adding [specific feature]"
   - "Move [element] to [specific location] for better [reason]"
 
Required analysis areas (if requested):
- CTA effectiveness and specificity
- Navigation clarity and state indicators  
- Trust signals and social proof prominence
- Content hierarchy and scanability
- Conversion optimization opportunities
- Accessibility considerations
 
Expected deliverables:
1. Heatmap overlay frame with colored attention rectangles (ALWAYS)
2. Figma annotations for each highlighted element (ONLY if requested)
3. Comprehensive improvement analysis summary covering all annotated elements (ONLY if requested)
 
Important Requirements:
- Follow exact color hex values (#FF0000, #FFC000, #00FF00) and exact opacity 0.5
- Use multiple smaller rectangles with full round edges to precisely cover elements when necessary
- Annotations and usability analysis are OPTIONAL - only include them if the user specifically requests them
- If improvement suggestions are provided (when requested), they must be:
  - Specific and actionable (not generic advice)
  - Based on recognized UX principles
  - Include concrete examples of better alternatives
  - Prioritized by potential impact on user experience
  - Written in both brief annotation form AND comprehensive analysis summary
- If you cannot meet the rules exactly, remove your work and retry until the heatmap adheres precisely to the policy`,
            },
          },
        ],
        description: "Strategy for generating a heatmap overlay based on user interaction data",
      };
    }
  },

  copy_writing: {
    title: "UX Writing Assistant with Compliance Guidelines",
    description:
      "Use UX writing guidelines to copywrite selected Figma frames with full compliance",
    inputSchema: z.object({}),
    handler: async () => {
      return {
        messages: [
          {
            role: "assistant" as const,
            content: {
              type: "text" as const,
              text: `# UX Writing Assistant

## Task

Use the UX Writing Guidelines from the 'uxwa.prompt.md' file to copywrite the selected frame in Figma. Apply all changes to achieve full compliance.

## Process

1. **Read Guidelines**: First, read and understand the complete UX Writing Guidelines from 'uxwa.prompt.md' in the workspace

2. **Analyze Frame**: Get the selected frame and scan all text nodes within it

3. **Apply Standards**: Rewrite all text content according to the guidelines you've read

4. **Update Figma**: Apply the changes to the Figma frame

## Expected Outcome

All text content in the selected frame will be rewritten to comply with UX writing standards, maintaining design integrity while improving content quality.`,
            }

          },
        ],
      };
    },
  },
};
// Helper function to register all prompts with the server
export function registerPrompts(server: any) {
  Object.entries(figmaPrompts).forEach(([promptName, prompt]) => {
    server.registerPrompt(
      promptName,
      {
        title: prompt.title,
        description: prompt.description,
        argsSchema: prompt.inputSchema.shape,
      },
      async () => {
        return await prompt.handler();
      }
    );
  });
}

export default figmaPrompts;