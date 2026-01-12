export class SSEParser {
  private decoder = new TextDecoder()
  private buffer = ''

  /**
   * Pushes a chunk of data to the parser and returns an array of parsed data strings.
   * @param chunk The Uint8Array chunk from the stream.
   * @returns An array of data strings (the part after 'data: ').
   */
  push(chunk: Uint8Array): string[] {
    this.buffer += this.decoder.decode(chunk, { stream: true })
    const lines = this.buffer.split('\n')
    // The last element is either an empty string or a partial line
    this.buffer = lines.pop() ?? ''

    const results: string[] = []
    for (let line of lines) {
      if (line.endsWith('\r')) {
        line = line.slice(0, -1)
      }

      // Skip empty lines or comments
      const trimmed = line.trimStart()
      if (!trimmed || !trimmed.startsWith('data:')) continue

      let data = trimmed.slice(5) // Remove 'data:'
      if (data.startsWith(' ')) {
        data = data.slice(1) // Remove optional single space
      }

      if (data === '[DONE]') continue

      results.push(data)
    }
    return results
  }

  /**
   * Decodes any remaining data in the buffer.
   * Useful when the stream is closed.
   */
  flush(): string[] {
    this.buffer += this.decoder.decode(new Uint8Array(), { stream: false })
    if (!this.buffer) return []

    const lines = this.buffer.split('\n')
    this.buffer = ''

    const results: string[] = []
    for (let line of lines) {
      if (line.endsWith('\r')) {
        line = line.slice(0, -1)
      }

      const trimmed = line.trimStart()
      if (!trimmed || !trimmed.startsWith('data:')) continue

      let data = trimmed.slice(5)
      if (data.startsWith(' ')) {
        data = data.slice(1)
      }

      if (data === '[DONE]') continue

      results.push(data)
    }
    return results
  }
}
