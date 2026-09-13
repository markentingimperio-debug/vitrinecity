import {createHash} from 'node:crypto';

// Keep this persisted contract identical for review, public visibility and
// internal distribution. Absent optional bindings preserve legacy hashes.
export function webStorySourceHash(source) {
  return createHash('sha256').update(JSON.stringify([
    source.title,source.summary,source.body,source.image_url,source.updated_at,
    ...(source.commercial?[source.facts,source.sourcePath]:[]),
    ...(source.reuseBinding?[source.reuseBinding]:[]),
  ])).digest('hex');
}
