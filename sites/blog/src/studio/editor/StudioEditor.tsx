/**
 * The studio's editor: the shared one (@allenkh/editor) with the blog's blocks, their editing
 * views, the "/" menu to match, and images that can be pasted or dropped in.
 */
import { RichTextEditor, type Doc, type SchemaOptions } from '@allenkh/editor';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { useEffect, useMemo } from 'react';
import { BlogCodeBlock, BlogImage, MathBlock, MathInline } from '../../editor/nodes';
import { STUDIO_BLOCKS } from './blocks';
import { ImageUploads, UploadProblem, uploadProblems } from './uploads';
import { CodeBlockView, ImageView, MathBlockView, MathInlineView } from './views';

/** The blog's schema (editor/nodes.ts), with the studio's views on its nodes. Names unchanged. */
function studioSchema(): SchemaOptions {
  return {
    extra: [
      BlogImage.extend({ addNodeView: () => ReactNodeViewRenderer(ImageView) }),
      MathInline.extend({ addNodeView: () => ReactNodeViewRenderer(MathInlineView) }),
      MathBlock.extend({ addNodeView: () => ReactNodeViewRenderer(MathBlockView) }),
    ],
    codeBlock: BlogCodeBlock.extend({ addNodeView: () => ReactNodeViewRenderer(CodeBlockView) }),
  };
}

/** Behaviour for the editor alone (nothing stored): images pasted or dropped in. */
const EDITOR_ONLY = [ImageUploads];

export function StudioEditor({
  value,
  onChange,
  onUploadError,
}: {
  value: Doc | null;
  onChange: (value: Doc | null) => void;
  onUploadError: (message: string) => void;
}) {
  useEffect(() => {
    const listener = (event: Event) => {
      if (event instanceof UploadProblem) onUploadError(event.message);
    };
    uploadProblems.addEventListener('problem', listener);
    return () => uploadProblems.removeEventListener('problem', listener);
  }, [onUploadError]);
  const schema = useMemo(() => studioSchema(), []);
  return (
    <RichTextEditor
      value={value}
      onChange={onChange}
      label="Post"
      placeholder="Write, or type “/” for blocks"
      schema={schema}
      blocks={STUDIO_BLOCKS}
      editorExtensions={EDITOR_ONLY}
      className="studio-prose"
    />
  );
}
