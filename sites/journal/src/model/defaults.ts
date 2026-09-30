/**
 * What a new journal starts with. Nothing here is written anywhere until it is changed: a journal
 * with no settings record reads these, and the first edit stores the whole record. So a new
 * device, or a new version of this file, never races another device to create them.
 *
 * Activity and mood ids are referenced by days, so they never change once shipped; names,
 * icons and colours are free to.
 */
import type { ActivityGroup, MoodDef, RichText, Settings } from './types';

/** DailyBean's five beans, in allenkh.com's families. Butter means "here", so great is butter. */
export const DEFAULT_MOODS: MoodDef[] = [
  { value: 5, label: 'Great', family: 'butter' },
  { value: 4, label: 'Good', family: 'mint' },
  { value: 3, label: 'Okay', family: 'sky' },
  { value: 2, label: 'Low', family: 'lilac' },
  { value: 1, label: 'Awful', family: 'coral' },
];

const group = (id: string, name: string, items: [string, string, string][]): ActivityGroup => ({
  id,
  name,
  items: items.map(([itemId, icon, itemName]) => ({
    id: itemId,
    name: itemName,
    icon,
    archived: false,
  })),
});

export const DEFAULT_ACTIVITIES: ActivityGroup[] = [
  group('feelings', 'Feelings', [
    ['happy', '😊', 'happy'],
    ['excited', '🤩', 'excited'],
    ['calm', '😌', 'calm'],
    ['grateful', '🥰', 'grateful'],
    ['proud', '😤', 'proud'],
    ['stressed', '😵‍💫', 'stressed'],
    ['tired', '🥱', 'tired'],
    ['sad', '😔', 'down'],
    ['anxious', '😟', 'anxious'],
    ['annoyed', '😒', 'annoyed'],
  ]),
  group('people', 'People', [
    ['family', '🏠', 'family'],
    ['friends', '🧑‍🤝‍🧑', 'friends'],
    ['classmates', '🎓', 'classmates'],
    ['someone-new', '👋', 'met someone'],
    ['alone', '🎧', 'time alone'],
  ]),
  group('school', 'School', [
    ['class', '📚', 'class'],
    ['homework', '✏️', 'homework'],
    ['lab', '🧪', 'lab'],
    ['exam', '📝', 'exam'],
    ['office-hours', '🙋', 'office hours'],
    ['club', '🛰️', 'club'],
  ]),
  group('making', 'Making', [
    ['rocketry', '🚀', 'rocketry'],
    ['coding', '💻', 'coding'],
    ['building', '🛠️', 'building'],
    ['cad', '📐', 'CAD'],
    ['design', '🎨', 'design'],
  ]),
  group('health', 'Health', [
    ['exercise', '🏃', 'exercise'],
    ['walk', '🚶', 'walk'],
    ['ate-well', '🥗', 'ate well'],
    ['slept-well', '😴', 'slept well'],
    ['slept-badly', '🌙', 'slept badly'],
  ]),
  group('fun', 'Fun', [
    ['games', '🎮', 'games'],
    ['movie', '🎬', 'movie'],
    ['reading', '📖', 'reading'],
    ['music', '🎵', 'music'],
    ['outdoors', '🌳', 'outdoors'],
    ['travel', '✈️', 'travel'],
  ]),
  group('weather', 'Weather', [
    ['sunny', '☀️', 'sunny'],
    ['cloudy', '⛅', 'cloudy'],
    ['rainy', '🌧️', 'rainy'],
    ['foggy', '🌫️', 'foggy'],
    ['windy', '🌬️', 'windy'],
  ]),
];

export const DEFAULT_PROMPTS: string[] = [
  'What made today different from yesterday?',
  'What are you proud of today?',
  'Who did you talk to, and what about?',
  'What did you learn today?',
  'What is on your mind right now?',
  'What small thing made you smile?',
  'What was hard today, and how did you handle it?',
  'What did you build, break or fix?',
  'What are you looking forward to?',
  'What would make tomorrow great?',
  'Where did your time go today?',
  'What surprised you today?',
  'What do you want to remember about today in a year?',
  'What are you grateful for?',
];

export const DEFAULT_SETTINGS: Omit<Settings, 'createdAt' | 'updatedAt'> = {
  kind: 'settings',
  v: 1,
  moods: DEFAULT_MOODS,
  prompts: DEFAULT_PROMPTS,
  reminder: { enabled: false, time: '21:30' },
  weekStart: 1,
  autoLockMinutes: 5,
};

const heading = (text: string) => ({
  type: 'heading',
  attrs: { level: 3 },
  content: [{ type: 'text', text }],
});
const paragraph = () => ({ type: 'paragraph' });

/** Built-in templates: offered on an empty day, and copied (never edited) when used. */
export const BUILT_IN_TEMPLATES: { id: string; name: string; icon: string; body: RichText }[] = [
  {
    id: 'builtin-reflection',
    name: 'Daily reflection',
    icon: '🌙',
    body: {
      type: 'doc',
      content: [
        heading('Highlights'),
        paragraph(),
        heading('What I learned'),
        paragraph(),
        heading('Tomorrow'),
        paragraph(),
      ],
    },
  },
  {
    id: 'builtin-gratitude',
    name: 'Three good things',
    icon: '🌼',
    body: {
      type: 'doc',
      content: [
        {
          type: 'orderedList',
          content: [1, 2, 3].map(() => ({ type: 'listItem', content: [paragraph()] })),
        },
      ],
    },
  },
  {
    id: 'builtin-week',
    name: 'Week in review',
    icon: '🗓️',
    body: {
      type: 'doc',
      content: [
        heading('Wins'),
        paragraph(),
        heading('Struggles'),
        paragraph(),
        heading('Next week'),
        paragraph(),
      ],
    },
  },
];
