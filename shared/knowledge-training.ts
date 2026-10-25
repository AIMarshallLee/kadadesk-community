export interface TrainingRecord {
  history?: import('./conversation-intent').ConversationTurn[];
  intent?: import('./conversation-intent').ConversationIntent;
  customerMarket?: import('./customer-market').CustomerMarket;
  id: string;
  question: string;
  answer: string;
  model: string;
  workflowId: string;
  knowledgeIds: string[];
  revision: string;
  createdAt: string;
  verdict: 'pending' | 'correct' | 'incorrect';
}
export interface TrainingView {
  records: Array<TrainingRecord & { current: boolean }>;
  suggestions: string[];
  approvedKnowledge: number;
  pendingKnowledge: number;
  checked: number;
  correct: number;
  incorrect: number;
}
