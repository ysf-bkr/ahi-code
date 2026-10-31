import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { buildSettings, parseArgs } from '../../packages/cli/src/index';

describe('CLI argument parsing and provider configuration', () => {
  it('parses --provider evren correctly and sets default model to auto', () => {
    const prevEnv = process.env.EVREN_API_KEY;
    process.env.EVREN_API_KEY = 'test-evren-key';
    try {
      const options = parseArgs(['--prompt', 'Test task', '--provider', 'evren']);
      assert.strictEqual(options.provider, 'evren');
      assert.strictEqual(options.apiKey, 'test-evren-key');

      const settings = buildSettings(options);
      assert.strictEqual(settings.selectedProvider, 'evren');
      assert.strictEqual(settings.selectedModel, 'auto');
      assert.strictEqual(settings.apiKeys.evren, 'test-evren-key');
    } finally {
      if (prevEnv !== undefined) {
        process.env.EVREN_API_KEY = prevEnv;
      } else {
        delete process.env.EVREN_API_KEY;
      }
    }
  });

  it('parses --provider openrouter and applies default model when omitted', () => {
    const options = parseArgs([
      '--prompt',
      'Review code',
      '--provider',
      'openrouter',
      '--api-key',
      'sk-or-test'
    ]);
    assert.strictEqual(options.provider, 'openrouter');
    assert.strictEqual(options.apiKey, 'sk-or-test');

    const settings = buildSettings(options);
    assert.strictEqual(settings.selectedProvider, 'openrouter');
    assert.strictEqual(settings.selectedModel, 'anthropic/claude-3.5-sonnet');
    assert.strictEqual(settings.apiKeys.openrouter, 'sk-or-test');
  });

  it('honours explicit --model override across providers', () => {
    const options = parseArgs([
      '--prompt',
      'Refactor module',
      '--provider',
      'openrouter',
      '--model',
      'openai/gpt-4o'
    ]);
    assert.strictEqual(options.model, 'openai/gpt-4o');

    const settings = buildSettings(options);
    assert.strictEqual(settings.selectedModel, 'openai/gpt-4o');
  });

  it('defaults to ollama and llama3.1 when provider and model are omitted', () => {
    const options = parseArgs(['--prompt', 'Fix bug']);
    assert.strictEqual(options.provider, 'ollama');

    const settings = buildSettings(options);
    assert.strictEqual(settings.selectedProvider, 'ollama');
    assert.strictEqual(settings.selectedModel, 'llama3.1');
    assert.strictEqual(settings.autoApprove.writeFiles, false);
    assert.strictEqual(settings.autoApprove.executeCommands, false);
  });

  it('enables autoApprove when --yes flag is passed', () => {
    const options = parseArgs(['--prompt', 'Generate tests', '--yes']);
    assert.strictEqual(options.yes, true);

    const settings = buildSettings(options);
    assert.strictEqual(settings.autoApprove.writeFiles, true);
    assert.strictEqual(settings.autoApprove.executeCommands, true);
  });

  it('throws descriptive error when --prompt is missing', () => {
    assert.throws(() => parseArgs(['--provider', 'ollama']), /--prompt is required/);
  });
});
