// Deterministic transport fixture; this is not an accuracy test of a live model.
export function routingFixture(body: any, title?: string): Response | undefined {
  if (!body.messages?.[0]?.content?.startsWith('KADADESK_CONVERSATION_ROUTING.')) return;
  const raw = body.messages[1].content;
  const payload = JSON.parse(typeof raw === 'string' ? raw : raw[0].text);
  const group = payload.catalog.find((g: any) => g.entries.some((k: any) => !title || k.title === title));
  const entry = group?.entries.find((k: any) => !title || k.title === title);
  const content = JSON.stringify(group ? {kind:'business',confidence:.99,topics:[{businessId:group.id,query:payload.latest,entryIds:[entry.id]}]} : {kind:'clarify',confidence:.99,topics:[]});
  return Response.json({choices:[{message:{content}}]});
}
