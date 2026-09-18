#!/usr/bin/env node
/**
 * A real, minimal MCP stdio server used as the live-mount fixture.
 *
 * Implements just enough of the MCP 2025 line protocol for the client under
 * test to complete `initialize`, `tools/list`, and one `tools/call`:
 * newline-delimited JSON-RPC 2.0 on stdin/stdout.
 *
 * It exposes exactly one tool, `ping`, so a passing probe proves the server's
 * tool really reached the registry rather than the count being inferred.
 */
import { createInterface } from 'node:readline'

const TOOLS = [
	{
		name: 'ping',
		description: 'Reply with pong and the supplied text.',
		inputSchema: {
			type: 'object',
			properties: { text: { type: 'string' } },
			additionalProperties: false
		}
	}
]

const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`)

createInterface({ input: process.stdin }).on('line', (line) => {
	if (line.trim() === '') return
	let request
	try {
		request = JSON.parse(line)
	} catch {
		return
	}
	if (request.id === undefined) return // notification
	const { id, method, params } = request
	switch (method) {
		case 'initialize':
			send({
				jsonrpc: '2.0',
				id,
				result: {
					protocolVersion: params?.protocolVersion ?? '2025-06-18',
					capabilities: { tools: {} },
					serverInfo: { name: 'probe-server', version: '1.0.0' }
				}
			})
			break
		case 'tools/list':
			send({ jsonrpc: '2.0', id, result: { tools: TOOLS } })
			break
		case 'tools/call':
			send({
				jsonrpc: '2.0',
				id,
				result: {
					content: [{ type: 'text', text: `pong:${params?.arguments?.text ?? ''}` }]
				}
			})
			break
		default:
			send({ jsonrpc: '2.0', id, error: { code: -32601, message: `unknown method ${method}` } })
	}
})
