/**
 * Cloudflare Pages Function: /api/start-round
 *
 * NOTE: This is meant for production on Cloudflare Pages so "Start Round" works
 * without relying on a separate Node/Express backend.
 */

type ThemeEntry = { theme: string; quotes: string[] };

const THEMES_DATABASE: ThemeEntry[] = [
  {
    theme: 'Freedom',
    quotes: [
      '"The only way to deal with an unfree world is to become so absolutely free that your very existence is an act of rebellion." — Albert Camus',
      '"Man is condemned to be free; because once thrown into the world, he is responsible for everything he does." — Jean-Paul Sartre',
      '"Those who would give up essential Liberty, to purchase a little temporary Safety, deserve neither Liberty nor Safety." — Benjamin Franklin',
    ],
  },
  {
    theme: 'Power',
    quotes: [
      `"Nearly all men can stand adversity, but if you want to test a man's character, give him power." — Abraham Lincoln`,
      '"Power tends to corrupt, and absolute power corrupts absolutely." — Lord Acton',
      '"The measure of a man is what he does with power." — Plato',
    ],
  },
  {
    theme: 'Truth',
    quotes: [
      '"The truth is rarely pure and never simple." — Oscar Wilde',
      '"In a time of deceit, telling the truth is a revolutionary act." — George Orwell',
      '"There are no facts, only interpretations." — Friedrich Nietzsche',
    ],
  },
  {
    theme: 'Justice',
    quotes: [
      '"Injustice anywhere is a threat to justice everywhere." — Martin Luther King Jr.',
      '"The arc of the moral universe is long, but it bends toward justice." — Theodore Parker',
      '"If you want peace, work for justice." — Pope Paul VI',
    ],
  },
  {
    theme: 'Success',
    quotes: [
      '"It is not enough to succeed. Others must fail." — Gore Vidal',
      '"Success is not final, failure is not fatal: it is the courage to continue that counts." — Winston Churchill',
      '"The only place where success comes before work is in the dictionary." — Vidal Sassoon',
    ],
  },
  {
    theme: 'Knowledge',
    quotes: [
      `"The more I learn, the more I realize how much I don't know." — Albert Einstein`,
      '"Knowledge is power, but enthusiasm pulls the switch." — Ivern Ball',
      `"Real knowledge is to know the extent of one's ignorance." — Confucius`,
    ],
  },
  {
    theme: 'Change',
    quotes: [
      '"The only constant in life is change." — Heraclitus',
      '"Be the change you wish to see in the world." — Mahatma Gandhi',
      '"Progress is impossible without change, and those who cannot change their minds cannot change anything." — George Bernard Shaw',
    ],
  },
  {
    theme: 'Courage',
    quotes: [
      '"Courage is not the absence of fear, but rather the judgment that something else is more important than fear." — Ambrose Redmoon',
      '"You gain strength, courage, and confidence by every experience in which you really stop to look fear in the face." — Eleanor Roosevelt',
      '"It takes courage to grow up and become who you really are." — E.E. Cummings',
    ],
  },
  {
    theme: 'Happiness',
    quotes: [
      '"Happiness is not something ready-made. It comes from your own actions." — Dalai Lama',
      '"The secret of happiness is not in doing what one likes, but in liking what one does." — James M. Barrie',
      '"Happiness depends upon ourselves." — Aristotle',
    ],
  },
  {
    theme: 'Morality',
    quotes: [
      '"The only thing necessary for the triumph of evil is for good men to do nothing." — Edmund Burke',
      '"Morality is not the doctrine of how we may make ourselves happy, but of how we may make ourselves worthy of happiness." — Immanuel Kant',
      '"Right is right, even if everyone is against it, and wrong is wrong, even if everyone is for it." — William Penn',
    ],
  },
];

function json(data: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...(init?.headers || {}),
    },
  });
}

export async function onRequestPost(): Promise<Response> {
  const randomIndex = Math.floor(Math.random() * THEMES_DATABASE.length);
  return json(THEMES_DATABASE[randomIndex]);
}


