
import { Database } from 'bun:sqlite'

const db = new Database('packages/cli/llmux-logs.db')
const query = db.prepare("SELECT post_transform_response FROM request_logs WHERE request_id = 'ho95cb'")
const row = query.get() as { post_transform_response: string } | null

if (row) {
  console.log('--- POST TRANSFORM RESPONSE START ---')
  console.log(row.post_transform_response)
  console.log('--- POST TRANSFORM RESPONSE END ---')
} else {
  console.log('No log entry found for request ho95cb')
}

db.close()
