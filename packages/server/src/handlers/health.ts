export async function handleHealth(_request: Request): Promise<Response> {
  return new Response(JSON.stringify({ status: 'ok', version: '0.1.0' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}
