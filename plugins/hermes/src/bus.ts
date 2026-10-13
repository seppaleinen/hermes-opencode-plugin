import { Message } from "./types.js";

export class MessageBus {
  private messages: Map<string, Message[]> = new Map();
  private queuedMessages: Map<string, Message[]> = new Map();

  send(message: Message): void {
    const target = message.target;
    if (!this.messages.has(target)) {
      this.messages.set(target, []);
    }
    this.messages.get(target)!.push(message);
  }

  getMessagesFor(component: string): Message[] {
    const msgs = this.messages.get(component) || [];
    return msgs;
  }

  queueForNextRound(target: string, message: Message): void {
    if (!this.queuedMessages.has(target)) {
      this.queuedMessages.set(target, []);
    }
    this.queuedMessages.get(target)!.push(message);
  }

  flush(): void {
    for (const [target, msgs] of this.queuedMessages) {
      if (!this.messages.has(target)) {
        this.messages.set(target, []);
      }
      this.messages.get(target)!.push(...msgs);
    }
    this.queuedMessages.clear();
  }

  clear(): void {
    this.messages.clear();
    this.queuedMessages.clear();
  }

  getAllMessages(): Message[] {
    const all: Message[] = [];
    for (const msgs of this.messages.values()) {
      all.push(...msgs);
    }
    return all;
  }
}
