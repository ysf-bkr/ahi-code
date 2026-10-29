import { WebviewToExtensionMessage } from '@shared/types';

declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

class VSCodeAPIWrapper {
  private readonly vsCodeApi: ReturnType<typeof acquireVsCodeApi> | undefined;

  constructor() {
    if (typeof acquireVsCodeApi === 'function') {
      this.vsCodeApi = acquireVsCodeApi();
    }
  }

  public postMessage(message: WebviewToExtensionMessage) {
    if (this.vsCodeApi) {
      this.vsCodeApi.postMessage(message);
    } else {
      // The browser preview has no extension host, so messages are silently ignored.
      void message;
    }
  }
}

export const vscode = new VSCodeAPIWrapper();
