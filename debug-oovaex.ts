
import { Database } from 'bun:sqlite';

const DB_PATH = '/home/dh/dev/CLIProxyAPI/llmux/packages/cli/llmux-logs.db';

try {
  const db = new Database(DB_PATH);
  
  // 1. Check if table exists and get columns
  const tableInfo = db.prepare("PRAGMA table_info(request_logs)").all();
  console.log("Columns:", tableInfo.map((c: any) => c.name).join(', '));

  // 2. Query the request
  const requestId = 'oovaex';
  const query = db.prepare(`
    SELECT 
      pre_transform_request, 
      post_transform_request, 
      pre_transform_response, 
      post_transform_response,
      error_message
    FROM request_logs 
    WHERE request_id = ?
  `);
  
  const row = query.get(requestId) as any;

  if (!row) {
    console.log(`No record found for request_id: ${requestId}`);
  } else {
    console.log('\n=== CLIENT REQUEST (Before) ===');
    console.log(row.pre_transform_request ? row.pre_transform_request.slice(0, 1000) + '...' : '(null)');

    console.log('\n=== UPSTREAM REQUEST (Transformed) ===');
    console.log(row.post_transform_request ? row.post_transform_request.slice(0, 1000) + '...' : '(null)');

    console.log('\n=== UPSTREAM RESPONSE (Raw from Provider) ===');
    // This might be large or empty if streaming
    console.log(row.pre_transform_response ? row.pre_transform_response.slice(0, 1000) + '...' : '(null)');

    console.log('\n=== CLIENT RESPONSE (After Transformation) ===');
    console.log(row.post_transform_response ? row.post_transform_response : '(null)');
    
    if (row.error_message) {
        console.log('\n=== ERROR ===');
        console.log(row.error_message);
    }
  }

  db.close();

} catch (error) {
  console.error("Database error:", error);
}
