/** Where a post stands with readers, in one word or three. */
import type { StudioPost } from '../../../server/posts';

export type Standing = 'draft' | 'published' | 'changed' | 'unpublished';

export function standing(post: Pick<StudioPost, 'status' | 'draftRev' | 'publishedRev'>): Standing {
  if (post.status === 'published')
    return post.publishedRev === post.draftRev ? 'published' : 'changed';
  return post.publishedRev === null ? 'draft' : 'unpublished';
}

const WORDS: Record<Standing, string> = {
  draft: 'Draft',
  published: 'Published',
  changed: 'Edits not live',
  unpublished: 'Taken down',
};

export function PublishState({
  post,
}: {
  post: Pick<StudioPost, 'status' | 'draftRev' | 'publishedRev'>;
}) {
  const state = standing(post);
  return (
    <span className="standing" data-standing={state}>
      {WORDS[state]}
    </span>
  );
}
