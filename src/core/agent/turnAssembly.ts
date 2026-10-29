/**
 * Ajan döngüsünden çıkarılmış saf tur-kurma yardımcıları; VS Code host'u
 * olmadan test edilebilir: saklanan sohbet geçmişini sağlayıcı mesajlarına
 * çevirmek ve modelin araç çağrısı yanıtını arayüzün ve denetim günlüğünün
 * beklediği ToolCall kayıtlarına eşlemek.
 */
import { ChatMessage, ToolCall, ToolName } from '../../shared/types';
import { ProviderMessage } from '../../providers/base';
import { PermissionManager } from '../permission/PermissionManager';

/**
 * Oturum geçmişinden modele gönderilecek mesaj dizisini kurar.
 *
 * - Sistem istemi her zaman başta gelir.
 * - Yalnızca sonucu kesinleşmiş araç çağrıları gönderilir: eşleşen araç
 * mesajı olmayan bekleyen/iptal edilmiş çağrılar API hatası verir.
 * - Boş asistan mesajları atlanır (bazı API'ler boş içeriği reddeder).
 */
export function buildProviderMessages(systemPrompt: string, messages: ChatMessage[]): ProviderMessage[] {
  const providerMessages: ProviderMessage[] = [{ role: 'system', content: systemPrompt }];

  for (const m of messages) {
    if (m.role === 'user') {
      providerMessages.push({ role: 'user', content: m.content });
    } else if (m.role === 'system') {
      // Model turlar arasında bağlamı korusun diye sistem mesajlarını dahil et.
      providerMessages.push({ role: 'system', content: m.content });
    } else if (m.role === 'assistant') {
      const resolvedToolCalls = (m.toolCalls || []).filter(
        (tc) => tc.status === 'completed' || tc.status === 'error' || tc.status === 'rejected'
      );

      if (!m.content && resolvedToolCalls.length === 0) {
        continue;
      }

      providerMessages.push({
        role: 'assistant',
        content: m.content,
        toolCalls:
          resolvedToolCalls.length > 0
            ? resolvedToolCalls.map((tc) => ({
                id: tc.id,
                name: tc.name,
                arguments: tc.args
              }))
            : undefined
      });

      for (const tc of resolvedToolCalls) {
        providerMessages.push({
          role: 'tool',
          toolCallId: tc.id,
          content:
            tc.result ||
            `[TOOL ERROR]: ${tc.error}\nTip: Analyze the error and take the next step to resolve it.`
        });
      }
    }
  }

  return providerMessages;
}

/**
 * Model yanıtındaki ham araç çağrılarını ToolCall kayıtlarına eşler;
 * her birini açıklama, onay gereksinimi ve izin motorundan gelen
 * okunabilir onay gerekçesiyle zenginleştirir.
 */
export function mapModelToolCalls(
  calls: Array<{ id: string; name: string; arguments: Record<string, unknown> }>,
  permissionManager: PermissionManager
): ToolCall[] {
  return calls.map((tc) => ({
    id: tc.id,
    name: tc.name as ToolName,
    args: tc.arguments,
    explanation: permissionManager.getToolExplanation(tc.name as ToolName, tc.arguments),
    requiresApproval: permissionManager.requiresApproval(tc.name as ToolName, tc.arguments),
    approvalReason: permissionManager.explainApproval(tc.name as ToolName, tc.arguments),
    status: 'pending'
  }));
}
