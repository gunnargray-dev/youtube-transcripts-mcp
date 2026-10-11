import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
const c=new Client({name:"paid",version:"1"});await c.connect(new StreamableHTTPClientTransport(new URL("https://parallelstudio--youtube-transcripts-mcp.apify.actor/mcp"),{requestInit:{headers:{Authorization:`Bearer ${process.env.APIFY_TOKEN}`}}}));
for(const [n,a] of [["get_transcript",{video:"aircAruvnKk"}],["search_videos",{query:"mcp server",limit:3}],["get_video_chapters",{video:"aircAruvnKk"}],["summarize_transcript",{video:"arj7oStGLkU",max_points:3}],["get_transcript",{video:"not a video"}]]){const r=await c.callTool({name:n,arguments:a});console.log(n,r.isError?"ERR":"ok")}
await c.close();
