/** Public contracts for trusted, bundled workflow definitions (not arbitrary plugin loading). */
export type WorkflowId = 'knowledge-to-content';
export type TaskStatus = 'running' | 'completed' | 'blocked' | 'interrupted';

export type WorkflowInfo = {
  id: WorkflowId;
  name: string;
  requiredPlugins: readonly string[];
  externalSend: false;
};

export type TaskRecord = {
  id: string;
  workflowId: WorkflowId;
  status: TaskStatus;
  title: string;
  createdAt: string;
  updatedAt: string;
  result?: {
    contentId: string;
    sourceIds: string[];
    manualReviewRequired: true;
    automaticExternalSend: false;
  };
  error?: string;
};
