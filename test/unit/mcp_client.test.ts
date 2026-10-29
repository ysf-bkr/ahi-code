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
   * Zombi yolunu yeniden üretir: stop() bekleyen `initialize` isteğini reject
   * eder; bu reddedilme eskiden başlangıç catch bloğunda durumu 'error''a
   * çeviriyor, scheduleReconnect'teki 'stopped' korumasını etkisiz bırakıyordu
   * ve reconnect zamanlayıcısı sunucuyu saniyeler sonra yeniden başlatıyordu.
   */
  it('stopped client does not respawn even if pending request rejected', async () => {
    // Initialize el sıkışmasını hiç yanıtlamayan bir süreç; böylece stop()
    // çağrıldığında bekleyen bir isteğin varlığı garanti olur.
    const client = new McpClient('zombie-test', {
      command: 'node',
      args: ['-e', 'setTimeout(() => {}, 600000)']
    });
    const startPromise = client.start();

    // Mikro görev kuyruğu otursun ki stop()'tan gelen reddedilme,
    // startStdioTransport'ın catch bloğunun içinde teslim edilsin.
    client.stop();
    const tools = await startPromise;
    await new Promise((resolve) => setTimeout(resolve, 50));

    assert.deepStrictEqual(tools, []);
    assert.strictEqual(client.status, 'stopped');

    // Reddedilme oturduktan sonra hiçbir reconnect zamanlayıcısı kurulmuş olmamalı.
    const internal = client as unknown as { reconnectTimer?: unknown };
    assert.strictEqual(internal.reconnectTimer, undefined);

    // Durmuş istemci sonraki yeniden başlatma denemelerini reddeder (ör. bayat bir zamanlayıcıdan).
    const restarted = await client.start();
    assert.deepStrictEqual(restarted, []);
    assert.strictEqual(client.status, 'stopped');
  });

  it('stopped client does not restart while timer waits', async () => {
    const client = new McpClient('timer-test', { command: 'definitely-missing-command-xyz' });
    // Başlangıç başarısız olur (spawn hatası) ve geri çekilmeli (backoff) bir reconnect zamanlar.
    await client.start();
    assert.notStrictEqual(client.status, 'connected');
    client.stop();

    // En kısa reconnect gecikmesinin (2s) biraz ötesini bekle; istemci
    // süreci yeniden başlatmak yerine durmuş kalmalı.
    await new Promise((resolve) => setTimeout(resolve, 2400));
    assert.strictEqual(client.status, 'stopped');
    const internal = client as unknown as { reconnectTimer?: unknown };
    assert.strictEqual(internal.reconnectTimer, undefined);
  });
});
