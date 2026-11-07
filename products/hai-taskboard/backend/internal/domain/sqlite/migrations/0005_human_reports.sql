CREATE TABLE human_reports (
 project_id TEXT NOT NULL CHECK(length(CAST(project_id AS BLOB)) BETWEEN 1 AND 80 AND instr(project_id,char(0))=0),
 report_id TEXT NOT NULL CHECK(length(report_id) BETWEEN 17 AND 33 AND substr(report_id,1,7)='report_' AND substr(report_id,8) NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*' AND instr(report_id,char(0))=0),
 work_item_id TEXT NOT NULL CHECK(length(CAST(work_item_id AS BLOB)) BETWEEN 1 AND 80 AND instr(work_item_id,char(0))=0),
 run_id TEXT NOT NULL CHECK(length(CAST(run_id AS BLOB)) BETWEEN 1 AND 80 AND instr(run_id,char(0))=0),
 subject_digest TEXT NOT NULL CHECK(length(CAST(subject_digest AS BLOB))=64 AND subject_digest NOT GLOB '*[^0-9a-f]*' AND instr(subject_digest,char(0))=0),
 actor_id TEXT NOT NULL CHECK(length(CAST(actor_id AS BLOB)) BETWEEN 1 AND 120 AND instr(actor_id,char(0))=0),
 kind TEXT NOT NULL CHECK(kind IN ('review','evidence')),
 artifact_digest TEXT NOT NULL CHECK(length(CAST(artifact_digest AS BLOB))=64 AND artifact_digest NOT GLOB '*[^0-9a-f]*' AND instr(artifact_digest,char(0))=0),
 created_at_ns INTEGER NOT NULL CHECK(created_at_ns>0),
 lease_epoch INTEGER NOT NULL CHECK(lease_epoch>0),
 restore_generation INTEGER NOT NULL CHECK(restore_generation>0),
 review_id TEXT,
 evidence_id TEXT,
 CHECK((kind='review' AND review_id=report_id AND review_id IS NOT NULL AND evidence_id IS NULL) OR (kind='evidence' AND evidence_id=report_id AND evidence_id IS NOT NULL AND review_id IS NULL)),
 PRIMARY KEY(project_id,report_id),
 FOREIGN KEY(project_id,work_item_id) REFERENCES work_items(project_id,work_item_id),
 FOREIGN KEY(project_id,run_id) REFERENCES runs(project_id,run_id),
 FOREIGN KEY(artifact_digest) REFERENCES artifacts(digest),
 FOREIGN KEY(project_id,review_id) REFERENCES reviews(project_id,review_id),
 FOREIGN KEY(project_id,evidence_id) REFERENCES evidence(project_id,evidence_id)
) STRICT;
CREATE INDEX human_reports_subject ON human_reports(project_id,subject_digest);
CREATE TRIGGER human_reports_no_update BEFORE UPDATE ON human_reports BEGIN SELECT RAISE(ABORT,'immutable human report'); END;
CREATE TRIGGER human_reports_no_delete BEFORE DELETE ON human_reports BEGIN SELECT RAISE(ABORT,'immutable human report'); END;
CREATE TRIGGER human_reports_no_replace BEFORE INSERT ON human_reports
WHEN EXISTS(SELECT 1 FROM human_reports WHERE project_id=NEW.project_id AND report_id=NEW.report_id)
BEGIN SELECT RAISE(ABORT,'immutable human report'); END;
CREATE TRIGGER human_reports_provenance BEFORE INSERT ON human_reports
WHEN NOT EXISTS(SELECT 1 FROM runs WHERE project_id=NEW.project_id AND run_id=NEW.run_id AND work_item_id=NEW.work_item_id)
 OR NOT EXISTS(SELECT 1 FROM artifacts WHERE digest=NEW.artifact_digest AND byte_length BETWEEN 1 AND 65536 AND media_type IN ('text/plain','text/markdown') AND availability='Present' AND storage_key='sha256:'||NEW.artifact_digest)
 OR (NEW.kind='review' AND NOT EXISTS(SELECT 1 FROM reviews WHERE project_id=NEW.project_id AND review_id=NEW.review_id AND completion_subject_digest=NEW.subject_digest AND reviewer_id=NEW.actor_id AND independent=1 AND created_at_ns=NEW.created_at_ns))
 OR (NEW.kind='evidence' AND NOT EXISTS(SELECT 1 FROM evidence WHERE project_id=NEW.project_id AND evidence_id=NEW.evidence_id AND completion_subject_digest=NEW.subject_digest AND verifier_actor=NEW.actor_id AND verifier_class='human' AND verifier_role='human' AND artifact_digest=NEW.artifact_digest AND verdict='Passed' AND applicability='Current' AND availability='Present'))
BEGIN SELECT RAISE(ABORT,'human report provenance mismatch'); END;
