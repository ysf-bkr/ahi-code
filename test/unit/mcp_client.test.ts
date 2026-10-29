import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { McpClient } from '../../src/core/mcp/McpClient';

describe('McpClient: basic status management', () => {
  it('does not start disabled server', async () => {
    const client = new McpClient('test', { command: 'echo', disabled: true });
    const tools = await client.start();
    assert.deepStrictEqual(tools, []);
    assert.strictEqual(client.status, 'stopped');
  });

  it('returns status with transport type', () => {
    const client = new McpClient('http-test', { url: 'https://example.com/mcp', type: 'http' });
    const status = client.getStatus();
    assert.strictEqual(status.name, 'http-test');
    assert.strictEqual(status.transport, 'http');
    assert.strictEqual(status.endpoint, 'https://example.com/mcp');
  });

  it('safely closes pending stop status', () => {
    const client = new McpClient('stop-test', { command: 'echo' });
    client.stop();
    assert.strictEqual(client.status, 'stopped');
  });
});

describe('McpClient: reconnect protection after stop (zombie regression)', () => {
  /**
   * Reproduces the zombie path: stop() rejects the pending `initialize`
   * request; the rejection used to flip status back to 'error' in the startup
   * catch block, defeating the 'stopped' guard in scheduleReconnect, and the
   * reconnect timer respawned the server seconds later.
   */
  it('stopped client does not respawn even if pending request rejected', async () => {
    // A process that never answers the initialize handshake, so a pending
    // request is guaranteed to exist when stop() is called.
    const client = new McpClient('zombie-test', {
      command: 'node',
      args: ['-e', 'setTimeout(() => {}, 600000)']
    });
    const startPromise = client.start();

    // Let the microtask queue settle so the rejection from stop() is
    // delivered inside startStdioTransport's catch block.
    client.stop();
    const tools = await startPromise;
    await new Promise((resolve) => setTimeout(resolve, 50));

    assert.deepStrictEqual(tools, []);
    assert.strictEqual(client.status, 'stopped');

    // No reconnect timer may be armed after the rejection settles.
    const internal = client as unknown as { reconnectTimer?: unknown };
    assert.strictEqual(internal.reconnectTimer, undefined);

    // A stopped client refuses later restarts (e.g. from a stale timer).
    const restarted = await client.start();
    assert.deepStrictEqual(restarted, []);
    assert.strictEqual(client.status, 'stopped');
  });

  it('stopped client does not restart while timer waits', async () => {
    const client = new McpClient('timer-test', { command: 'definitely-missing-command-xyz' });
    // Startup fails (spawn error) and schedules a reconnect with backoff.
    await client.start();
    assert.notStrictEqual(client.status, 'connected');
    client.stop();

    // Wait past the shortest reconnect delay (2s) plus margin; the client
    // must remain stopped instead of respawning the process.
    await new Promise((resolve) => setTimeout(resolve, 2400));
    assert.strictEqual(client.status, 'stopped');
    const internal = client as unknown as { reconnectTimer?: unknown };
    assert.strictEqual(internal.reconnectTimer, undefined);
  });
});
