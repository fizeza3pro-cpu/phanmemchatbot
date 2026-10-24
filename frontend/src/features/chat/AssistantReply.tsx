import {
  lazy,
  memo,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { FastForward } from 'lucide-react';
import type { Message } from '../../lib/types';
import { useTheme } from '../theme';

const Markdown = lazy(() => import('./Markdown'));
const segmenter = new Intl.Segmenter('vi', { granularity: 'grapheme' });

export default memo(function AssistantReply({
  message,
  animate,
  copied,
  onCopy,
  onProgress,
  onComplete,
}: {
  message: Message;
  animate: boolean;
  copied: boolean;
  onCopy: (id: string, content: string) => Promise<void>;
  onProgress: () => void;
  onComplete: (id: string) => void;
}) {
  const { reducedMotion } = useTheme();
  const boundaries = useMemo(
    () =>
      Array.from(
        segmenter.segment(message.content),
        ({ index, segment }) => index + segment.length
      ),
    [message.content]
  );
  const [shown, setShown] = useState(0);
  const frame = useRef(0);
  const revealing = animate && !reducedMotion && shown < boundaries.length;
  const content = revealing
    ? message.content.slice(0, boundaries[shown - 1] ?? 0)
    : message.content;

  useEffect(() => {
    if (!animate || reducedMotion) return;
    setShown(0);
    const duration = Math.min(9000, Math.max(600, boundaries.length * 12));
    const started = performance.now();
    let lastPaint = 0;
    const tick = (now: number) => {
      const progress = Math.min(1, (now - started) / duration);
      if (now - lastPaint >= 45 || progress === 1) {
        setShown(Math.floor(progress * boundaries.length));
        lastPaint = now;
      }
      if (progress < 1) frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame.current);
  }, [animate, reducedMotion, boundaries.length]);
  useEffect(() => {
    if (!animate) return;
    onProgress();
    if (!revealing) onComplete(message.id);
  }, [animate, shown, revealing, message.id, onProgress, onComplete]);

  return (
    <article
      className={`message assistant${revealing ? ' is-revealing' : ''}`}
      data-message-id={message.id}
    >
      {revealing && <p className="sr-only">{message.content}</p>}
      <div
        className="message-body"
        aria-hidden={revealing || undefined}
        aria-live="off"
        inert={revealing}
      >
        <Suspense fallback={<p className="plain-message">{content}</p>}>
          <Markdown content={content} />
        </Suspense>
        {revealing && <span className="reply-cursor" aria-hidden="true" />}
      </div>
      <div className="reply-actions">
        <button
          type="button"
          className="copy-button"
          onClick={() => void onCopy(message.id, message.content)}
          aria-label="Sao chép câu trả lời"
        >
          <span>{copied ? 'Đã sao chép' : 'Sao chép'}</span>
        </button>
        {revealing && (
          <button
            type="button"
            className="reveal-now"
            onClick={() => {
              cancelAnimationFrame(frame.current);
              setShown(boundaries.length);
              onComplete(message.id);
            }}
          >
            <FastForward size={14} />
            Hiện ngay
          </button>
        )}
      </div>
    </article>
  );
});
