-- Screenshots gain a free-text description: what the shot shows and why it was
-- captured, settable by the uploading agent and editable in the web UI.

ALTER TABLE screenshots ADD COLUMN description TEXT;
