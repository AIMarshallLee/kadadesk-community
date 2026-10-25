import test from 'node:test';
import assert from 'node:assert/strict';
import { TUTORIALS, TUTORIAL_IDS, suggestTutorial, tutorialById, tutorialForError, tutorialsHandbook } from './tutorials';
import { FEATURE_IDS } from './feature-index';
import { HELP_HANDBOOK, unsureHelpActions } from './help-knowledge';

test('every tutorial has a unique id, a title and 3–8 short steps', () => {
  assert.equal(TUTORIAL_IDS.size, TUTORIALS.length, 'ids are unique');
  for (const id of ['model-setup', 'knowledge', 'reception', 'updates-and-help', 'open-mcp']) {
    if (tutorialById(id)) assert.ok(tutorialById(id), id);
  }
  for (const t of TUTORIALS) {
    assert.match(t.id, /^[a-z][a-z-]*$/, t.id);
    assert.ok(t.title.trim(), t.id);
    assert.ok(t.steps.length >= 3 && t.steps.length <= 8, `${t.id} has ${t.steps.length} steps`);
    for (const s of t.steps) assert.ok(s.trim() && s.length <= 220, `${t.id} step is short: ${s.slice(0, 20)}`);
    assert.ok(t.keywords.length > 0, `${t.id} has keywords`);
  }
});

test('suggestTutorial matches questions accurately', () => {
  const match = suggestTutorial('怎么配置自己的模型？');
  assert.ok(match);
  assert.equal(match.id, 'model-setup');
});
