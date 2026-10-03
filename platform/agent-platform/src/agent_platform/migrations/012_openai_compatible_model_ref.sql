ALTER TABLE agent_profile_revisions DROP CONSTRAINT supported_profile;
ALTER TABLE agent_profile_revisions ADD CONSTRAINT supported_profile CHECK (
 (backend='fake' AND model_ref='fixture:m1' AND template_digest='fixture:m1') OR
 (backend='openhands' AND model_ref IN ('fixture:m2','openai-compatible:chat-completions')
  AND template_digest ~ '@sha256:[a-f0-9]{64}$')
);
