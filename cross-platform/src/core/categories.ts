// Local defaults, based on bank MCC lists. Broad ecosystem codes 3990/3991 stay unknown.
// https://alfabank.ru/help/t/corp/korporativnie-debetovie-karti/alfa-biznes/obshchaya-informatsiya-po-karte/po-kakim-kategoriyam-mozhno-nastroit-oplatu/
// https://mtsdengi.ru/static/documents/cashback_client.pdf
// https://www.finambank.ru/files/u/dw/bank/person/documents/file157/sajt_programma_loyal_nosti_cashback_01072024.pdf
export const mccGroups: Record<string, number[]> = {
  Продукты: [5411, 5422, 5441, 5451, 5462, 5499],
  "Кафе и рестораны": [5811, 5812, 5813, 5814],
  Транспорт: [
    4111, 4112, 4121, 4131, 4784, 4789, 5172, 5541, 5542, 5552, 5983, 5531,
    5532, 5533, 7512, 7513, 7519, 7523, 7531, 7534, 7535, 7538, 7542, 7549,
  ],
  Здоровье: [
    4119, 5047, 5122, 5912, 5975, 5976, 8011, 8021, 8031, 8041, 8042, 8043,
    8044, 8049, 8050, 8062, 8071, 8099,
  ],
  "Связь и подписки": [4812, 4814, 4816, 4899],
  "Жильё и ЖКХ": [4900],
  Образование: [8211, 8220, 8241, 8244, 8249, 8299, 8351],
  Путешествия: [4411, 4511, 4582, 4722, 7011],
  Покупки: [
    5137, 5139, 5300, 5310, 5311, 5331, 5399, 5611, 5621, 5631, 5641, 5651,
    5655, 5661, 5681, 5691, 5697, 5698, 5699, 5712, 5713, 5714, 5719, 5722,
    5732, 5734, 5931, 5940, 5941, 5942, 5943, 5944, 5945, 5946, 5947, 5948,
    5949, 5950, 5992, 5995,
  ],
  Развлечения: [
    7829, 7832, 7841, 7911, 7922, 7929, 7932, 7933, 7941, 7991, 7992, 7993,
    7994, 7996, 7997, 7998, 7999,
  ],
  "Красота и уход": [5977, 7230, 7297, 7298],
};
export const mccDefaults: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(mccGroups).flatMap(([category, codes]) =>
    codes.map((code) => [String(code), category]),
  ),
);
export function extractMCC(details: string): string | undefined {
  const codes = new Set(
    [...details.matchAll(/(?:\bMCC|МСС)\s*[:=]?\s*(\d{4})(?!\d)/giu)].map(
      (m) => m[1],
    ),
  );
  return codes.size === 1 ? [...codes][0] : undefined;
}
export function bankCategoryName(raw = ""): string | undefined {
  const name = raw.toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim();
  const aliases: Record<string, string[]> = {
    Продукты: ["продукты", "супермаркеты", "продуктовые магазины"],
    "Кафе и рестораны": [
      "кафе и рестораны",
      "рестораны и кафе",
      "рестораны",
      "фастфуд",
      "кафе",
      "бары",
    ],
    Транспорт: [
      "транспорт",
      "такси",
      "каршеринг",
      "азс",
      "автоуслуги",
      "общественный транспорт",
    ],
    Здоровье: ["здоровье", "аптеки", "медицинские услуги"],
    "Жильё и ЖКХ": ["жилье и жкх", "жкх", "коммунальные платежи"],
    "Связь и подписки": [
      "связь и подписки",
      "связь",
      "мобильная связь",
      "интернет",
    ],
    "Красота и уход": ["красота и уход", "красота", "салоны красоты"],
    Образование: ["образование"],
    Путешествия: ["путешествия", "авиабилеты", "отели", "туризм"],
    Покупки: [
      "покупки",
      "одежда и обувь",
      "электроника",
      "книги",
      "маркетплейсы",
    ],
    Развлечения: ["развлечения", "кино", "спорт"],
  };
  return Object.entries(aliases).find(([, names]) => names.includes(name))?.[0];
}

const merchantPatterns = (
  [
    ["Оплата Codex", "codex"],
    [
      "Продукты",
      "(?:пятерочка|пятерочк[аи]|pyaterochka|pyaterochk|perekrestok|перекресток|vkusvill|вкусвилл|magnit|магнит|mariya ra|мария ра|bystronom|быстроном|dobryanka|добрянка|auchan|ашан|lenta|лента|дикси|dixy|окей|o key|spar|азбука вкуса|azbuka vkusa|supermarket|супермаркет|продукты)\\d*",
    ],
    [
      "Кафе и рестораны",
      "(?:cafe|кафе|coffee|кофе|coffeeshop|кофейня|restaurant|restoran|ресторан|столовая|stolovaya|burgers?|бургер(?:ы)?|pizza|пицца|pizzeria|пиццерия|kfc|rostics|ростикс|вкусно и точка|teremok|теремок|dodo|додо|vilka loz(?:h)?ka|вилка ложка)\\d*",
    ],
    [
      "Транспорт",
      "(?:taxi|такси|delimobil|делимобиль|belkacar|ситидрайв|citydrive|whoosh|вуш|urent|юрент|тройка|troika|tpp metro|metro tpp|metropoliten|метрополитен|проезд|proezd|rzd|ржд|parking|парковк[аи]|азс|azs|заправка|lukoil|лукойл|gazpromneft|газпромнефть|rosneft|роснефть)\\d*",
    ],
    [
      "Здоровье",
      "(?:аптека|аптеки|apteka|apteki|pharmacy|клиника|klinika|clinic|стоматология|stomatologiya|dental|инвитро|invitro|гемотест|gemotest)\\d*",
    ],
    [
      "Связь и подписки",
      "(?:мегафон|megafon|mts|мтс|tele2|t2|билайн|beeline|ростелеком|rostelecom|netflix|spotify|подписка)\\d*",
    ],
    [
      "Жильё и ЖКХ",
      "(?:жкх|квартплата|mosenergosbyt|мосэнергосбыт|коммунальные услуги)",
    ],
    [
      "Путешествия",
      "(?:hotel|отель|гостиница|hostel|хостел|aeroflot|аэрофлот|pobeda airlines|авиакомпания победа|ural airlines|s7 airlines)",
    ],
    [
      "Развлечения",
      "(?:кинотеатр|cinema|театр|theatre|музей|museum|зоопарк|аквапарк|aquapark|кино|kino)",
    ],
    [
      "Красота и уход",
      "(?:парикмахерская|barbershop|барбершоп|салон красоты|маникюр|косметика|cosmetics)",
    ],
  ] as [string, string][]
).map(([category, pattern]) => ({
  category,
  pattern: new RegExp(`(?:^| )${pattern}(?= |$)`, "u"),
}));

// Merchant words are hints, not MCCs. Only inspect a purchase's merchant, never a transfer comment.
export function merchantCategory(details: string): string | undefined {
  const raw =
    details.match(
      /место совершения операции:\s*(.*?)(?:,\s*(?:MCC|МСС)\b|$)/iu,
    )?.[1] ??
    details.match(
      /^(?:оплата в|оплата услуг|оплата товаров и услуг|покупка в|отмена операции оплаты|возврат (?:покупки|оплаты)(?: в)?|возврат средств по оплате)\s+(.+)/iu,
    )?.[1] ??
    details.match(/^(.+?)\.\s*Операция по карте\s+\*{4}\d{4}$/iu)?.[1];
  if (!raw) return;
  const name = raw
    .replace(/^[A-Z]{2,3}\/[^/]+\//i, "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\d]+/gu, " ")
    .trim();
  const has = (pattern: string) =>
    new RegExp(`(?:^| )${pattern}(?= |$)`, "u").test(name);
  if (has("(?:yandex|яндекс)")) {
    const services: [string, string][] = [
      ["(?:taxi|такси|go|scooters|самокаты)", "Транспорт"],
      ["(?:lavka|лавка)", "Продукты"],
      ["(?:eda|еда)", "Кафе и рестораны"],
      ["(?:plus|плюс|music|музыка|kinopoisk|кинопоиск)", "Связь и подписки"],
    ];
    const matches = new Set(services.filter(([p]) => has(p)).map(([, c]) => c));
    return matches.size === 1 ? [...matches][0] : undefined;
  }
  const matches = new Set(
    merchantPatterns
      .filter(({ pattern }) => pattern.test(name))
      .map(({ category }) => category),
  );
  return matches.size === 1 ? [...matches][0] : undefined;
}

export function normalizedMerchant(raw: string): string | undefined {
  let name = raw.trim();
  // Alfa gives country/city/merchant; T-Bank puts city and country after the merchant.
  if (/^[A-Z]{2,3}\/[^/]+\//i.test(name))
    name = name.split("/").slice(2).join("/");
  else
    name = name.replace(
      /\s+[\p{L}\d.-]+\s+(?:RUS|RU|RUSSIA|AE|ARE|USA|US|GB|GBR|KZ|KAZ|TR|TUR)\s*$/iu,
      "",
    );
  const key = name
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\d]/gu, "");
  // Digits and service names remain significant: SHOP 1 != SHOP 2, TAXI != LAVKA.
  return (key.match(/\p{L}/gu)?.length ?? 0) >= 3 ? key : undefined;
}
