#!/bin/bash

# Create .cursor directory if it doesn't exist
mkdir -p .vscode

bun install

# Create mcp.json with the current directory path
echo "{
  \"servers\": {
    \"TalkToFigma\": {
      \"command\": \"bun\",
      \"args\": [\"run\", \"./src/talk_to_figma_mcp/server.ts\"]
    }
  }
}" > .vscode/mcp.json 