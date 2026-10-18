-- Verdict revisions: a session keeps every version of its verdict in its document, the debate's own verdict being
-- revision 1. The sessions ruled on before keep their verdict as revision 1, dated when they were last saved.

UPDATE sessions
SET data = jsonb_set(data, '{revisions}', jsonb_build_array(jsonb_build_object(
  'number', 1,
  'createdAt', data->'updatedAt',
  'reason', 'debate',
  'inputs', jsonb_build_object('facts', '[]'::jsonb, 'note', NULL, 'questionnaireId', NULL),
  'basedOn', NULL,
  'verdict', data->'verdict',
  'costs', '[]'::jsonb,
  'critiques', '[]'::jsonb,
  'by', NULL
)))
WHERE data->'revisions' IS NULL AND jsonb_typeof(data->'verdict') = 'object';
