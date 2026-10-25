export type CompanionMode = 'auto' | 'left' | 'right' | 'floating';
export type CompanionTarget = { id: string; title: string; browser: boolean };
export type CompanionState = { mode: CompanionMode; target?: CompanionTarget; placement: 'left' | 'right' | 'floating'; message: string; inputOwner?: 'human' | 'preparing' | 'pico' };
export interface CompanionBridge {
  targets(): Promise<CompanionTarget[]>;
  state(): Promise<CompanionState>;
  configure(input: { targetId?: string; mode?: CompanionMode }): Promise<CompanionState>;
}
