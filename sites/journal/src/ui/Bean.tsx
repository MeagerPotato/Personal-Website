/**
 * The mood beans: DailyBean's idea, drawn flat in allenkh.com's families. Five faces, great to
 * awful, each on its mood's colour; an empty day is a dashed outline.
 */
import type { FamilyKey } from '@allenkh/design/tokens';

/** The bean's body: a jelly bean, fuller at the bottom, tipped a little to the right. */
const BODY =
  'M25.2 6.2c8.9.6 15.4 7.2 15.9 15.9.5 9.8-5.3 18.9-15.4 19.8C15.4 42.8 6.9 36.6 6.9 26.4 6.9 15 14.7 5.5 25.2 6.2Z';

const FACES: Record<number, { eyes: string; mouth: string; fillMouth?: boolean }> = {
  5: {
    eyes: 'M16.6 23.2q2.4-3.2 4.8 0M27.4 23.2q2.4-3.2 4.8 0',
    mouth: 'M18.4 28.4q5.8 6.4 11.6 0Z',
    fillMouth: true,
  },
  4: { eyes: '', mouth: 'M19.2 29q4.8 4 9.6 0' },
  3: { eyes: '', mouth: 'M19.6 30.4h8.8' },
  2: { eyes: '', mouth: 'M19.4 31.8q4.6-3.4 9.2 0' },
  1: { eyes: 'M16.4 21.2l4.4 2.2M31.8 21.2l-4.4 2.2', mouth: 'M18.6 32.6q5.4-5 10.8 0' },
};

export interface BeanProps {
  /** 1 … 5, or null for a day without a mood. */
  mood: number | null;
  family?: FamilyKey;
  size?: number | string;
  /** A label for assistive technology; omit when the bean is decoration next to text. */
  title?: string;
  className?: string;
}

export function Bean({ mood, family, size = 40, title, className }: BeanProps) {
  const face = mood === null ? null : FACES[mood];
  const dots = mood !== null && mood >= 2 && mood <= 4;
  return (
    <svg
      className={`bean ${className ?? ''}`.trim()}
      viewBox="0 0 48 48"
      width={size}
      height={size}
      data-family={family}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      {face ? (
        <>
          <path className="bean__body" d={BODY} />
          <ellipse
            className="bean__shine"
            cx="17.5"
            cy="13.5"
            rx="4.2"
            ry="2.4"
            transform="rotate(-28 17.5 13.5)"
          />
          {dots ? (
            <>
              <circle className="bean__eye" cx="19" cy="22.4" r="1.9" />
              <circle className="bean__eye" cx="29.4" cy="22.4" r="1.9" />
            </>
          ) : (
            <path className="bean__line" d={face.eyes} />
          )}
          <path className={face.fillMouth ? 'bean__mouth' : 'bean__line'} d={face.mouth} />
        </>
      ) : (
        <path className="bean__empty" d={BODY} />
      )}
    </svg>
  );
}
