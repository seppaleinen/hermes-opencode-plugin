import { Message } from "./types.js";

export class MessageBus {
  private messages: Map<string, Message[]> = new Map();
  private queuedMessages: Map<string, Message[]> = new Map();
  private readPointers: Map<string, number> = new Map();
  private sequence = 0;

  send(message: Message): void {
    const target = message.target;
    const seq = this.sequence++;
    const enriched = { ...message, _seq: seq } as Message & { _seq: number };
    if (!this.messages.has(target)) {
      this.messages.set(target, []);
    }
    this.messages.get(target)!.push(enriched);
  }

  /**
   * Strip the internal `_seq` ordering tag so callers (prompts, logs) see
   * plain Message objects — the tag must never leak into model prompts or
   * serialized run logs (byte-identical baseline requirement).
   */
  private stripSeq(msg: Message): Message {
    const { _seq, ...rest } = msg as Message & { _seq: number };
    return rest as Message;
  }

  getMessagesFor(component: string): Message[] {
    const msgs = this.messages.get(component) || [];
    // Deterministic total order: sequence number = send() call order.
    // (The array is already in insertion order; the sort is defensive.)
    return [...msgs]
      .sort((a, b) => (a as Message & { _seq: number })._seq - (b as Message & { _seq: number })._seq)
      .map(m => this.stripSeq(m));
  }

  getUnreadMessagesFor(component: string): Message[] {
    const msgs = this.messages.get(component) || [];
    const ptr = this.readPointers.get(component) ?? 0;
    const unread = msgs.slice(ptr);
    this.readPointers.set(component, msgs.length);
    return unread.map(m => this.stripSeq(m));
  }

  hasUnread(component: string): boolean {
    const msgs = this.messages.get(component) || [];
    const ptr = this.readPointers.get(component) ?? 0;
    return msgs.length > ptr;
  }

  /**
   * Number of messages currently delivered to a target's inbox (all of them,
   * read or not). The parallel scheduler uses this together with its own
   * per-component read pointer to detect NEW messages that arrived after a
   * pass consumed its inbox — without advancing the bus's shared pointer,
   * which would race with concurrent in-flight passes.
   */
  inboxLength(component: string): number {
    return this.messages.get(component)?.length ?? 0;
  }

  markRead(component: string): void {
    const msgs = this.messages.get(component) || [];
    this.readPointers.set(component, msgs.length);
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
