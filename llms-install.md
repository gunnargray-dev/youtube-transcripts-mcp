# Installing YouTube Transcripts MCP

Option A, hosted (recommended; YouTube blocks many server IPs, the hosted version routes through Apify Proxy):
URL: https://parallelstudio--youtube-transcripts-mcp.apify.actor/mcp
Header: Authorization: Bearer <APIFY_TOKEN>  (get a token at https://console.apify.com/settings/integrations)

Option B, local stdio (free, no keys; works from residential IPs):
1. git clone https://github.com/gunnargray-dev/youtube-transcripts-mcp && cd youtube-transcripts-mcp
2. npm install && npm run build
3. MCP config: {"mcpServers":{"youtube-transcripts":{"command":"node","args":["/ABSOLUTE/PATH/youtube-transcripts-mcp/dist/index.js"]}}}

Tools: get_transcript, search_videos, get_video_chapters, summarize_transcript.
