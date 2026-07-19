// Bidirectional brand/model synonym table.
// Each entry: [latin variants..., cyrillic variants...]
// All entries are lowercase. Lookup works both ways.
const SYNONYMS = [
  // Brands
  ['kia',          'киа'],
  ['bmw',          'бмв'],
  ['vw', 'volkswagen', 'фольксваген', 'фолькс'],
  ['mercedes', 'mercedes-benz', 'мерседес', 'мерс'],
  ['toyota',       'тойота'],
  ['honda',        'хонда'],
  ['hyundai',      'хундай', 'хёндай', 'хендай'],
  ['nissan',       'ниссан'],
  ['ford',         'форд'],
  ['chevrolet',    'шевроле', 'шеви'],
  ['renault',      'рено'],
  ['peugeot',      'пежо'],
  ['audi',         'ауди'],
  ['skoda',        'шкода'],
  ['opel',         'опель'],
  ['volvo',        'вольво'],
  ['lada', 'vaz',  'лада', 'ваз'],
  ['mazda',        'мазда'],
  ['mitsubishi',   'мицубиси', 'митсубиши', 'мицубиши'],
  ['subaru',       'субару'],
  ['lexus',        'лексус'],
  ['land rover',   'ленд ровер'],
  ['range rover',  'рэнж ровер'],
  ['porsche',      'порше'],
  ['alfa romeo',   'альфа ромео'],
  ['fiat',         'фиат'],
  ['jeep',         'джип'],
  ['dodge',        'додж'],
  ['chrysler',     'крайслер'],
  ['cadillac',     'кадиллак'],
  ['seat',         'сеат'],
  ['citroen',      'ситроен', 'ситроэн'],
  ['dacia',        'дачия', 'дачиа'],
  ['mini',         'мини'],
  ['suzuki',       'сузуки'],
  ['infiniti',     'инфинити'],
  ['acura',        'акура'],
  ['geely',        'джили', 'гили'],
  ['chery',        'чери'],
  ['haval',        'хавал', 'хавейл'],
  ['uaz',          'уаз'],
  ['datsun',       'датсун'],
  ['daewoo',       'дэу', 'деу'],
  ['ssangyong', 'ssang yong', 'санг енг', 'ссангйонг'],
  ['genesis',      'генезис'],
  ['exeed',        'эксид'],
  ['omoda',        'омода'],
  ['changan',      'чанган'],
  ['great wall',   'грейт вол'],
  // Common models
  ['vesta',        'веста'],
  ['granta',       'гранта'],
  ['priora',       'приора'],
  ['kalina',       'калина'],
  ['niva',         'нива'],
  ['ceed', 'cee d', 'сид'],
  ['cerato',       'церато'],
  ['optima',       'оптима'],
  ['picanto',      'пиканто'],
  ['soul',         'соул'],
  ['seltos',       'селтос'],
  ['sonata',       'соната'],
  ['elantra',      'элантра'],
  ['accent',       'акцент'],
  ['getz',         'гетц'],
  ['santa fe', 'santafe', 'санта фе'],
  ['ix35',         'икс35'],
  ['kuga',         'куга'],
  ['fiesta',       'фиеста'],
  ['ecosport',     'экоспорт'],
  ['explorer',     'эксплорер'],
  ['astra',        'астра'],
  ['corsa',        'корса'],
  ['insignia',     'инсигния'],
  ['vectra',       'вектра'],
  ['zafira',       'зафира'],
  ['mokka',        'мокка'],
  ['accord',       'аккорд'],
  ['civic',        'цивик'],
  ['cr-v', 'crv',  'срв'],
  ['juke',         'жук', 'джук'],
  ['note',         'ноут'],
  ['terrano',      'террано'],
  ['kaptur',       'каптюр', 'каптур'],
  ['arkana',       'аркана'],
  ['highlander',   'хайлендер'],
  ['forester',     'форестер'],
  ['outback',      'аутбек'],
  ['impreza',      'импреза'],
  ['xv',           'икс ви'],
  ['asx',          'асх'],
  ['lancer',       'лансер'],
  ['pajero',       'паджеро'],
  ['l200',         'л200'],
  ['swift',        'свифт'],
  ['vitara',       'витара'],
  ['sx4',          'сх4'],
  ['rio',          'рио'],
  ['polo',         'поло'],
  ['octavia',      'октавия'],
  ['rapid',        'рапид'],
  ['fabia',        'фабия'],
  ['superb',       'суперб'],
  ['tiguan',       'тигуан'],
  ['golf',         'гольф'],
  ['passat',       'пассат'],
  ['solaris',      'солярис'],
  ['creta',        'крета'],
  ['tucson',       'туксон'],
  ['camry',        'камри'],
  ['corolla',      'королла'],
  ['focus',        'фокус'],
  ['mondeo',       'мондео'],
  ['duster',       'дастер'],
  ['x1',           'х1'],
  ['x3',           'х3'],
  ['x5',           'х5'],
  ['x6',           'х6'],
  ['rav4',         'рав4', 'рав 4'],
  ['logan',        'логан'],
  ['sandero',      'сандеро'],
  ['jetta',        'джетта'],
  ['touareg',      'туарег'],
  ['sportage',     'спортаж'],
  ['sorento',      'соренто'],
  ['outlander',    'аутлендер'],
  ['qashqai',      'кашкай'],
  ['x-trail',      'иксклорр', 'х трейл'],
  ['pathfinder',   'патфайндер'],
  ['murano',       'мурано'],
  ['teana',        'тиана'],
  ['almera',       'альмера'],
  ['tiida',        'тиида'],
  ['yaris',        'ярис'],
  ['auris',        'аурис'],
  ['avensis',      'авенсис'],
  ['hilux',        'хайлюкс'],
  ['land cruiser', 'ленд крузер'],
  ['prado',        'прадо'],
  ['captiva',      'каптива'],
  ['cruze',        'круз'],
  ['aveo',         'авео'],
  ['lacetti',      'лачетти'],
  ['scenic',       'сценик'],
  ['megane',       'меган'],
  ['laguna',       'лагуна'],
  ['fluence',      'флюенс'],
  ['koleos',       'колеос'],
  ['308',          '308'],
  ['408',          '408'],
  ['508',          '508'],
  ['3008',         '3008'],
  ['5008',         '5008'],
  ['cx5',  'cx-5', 'сх5',  'сх-5'],
  ['cx3',  'cx-3', 'сх3'],
  ['cx7',  'cx-7', 'сх7'],
  ['cx9',  'cx-9', 'сх9'],
  ['c4',           'с4'],
  ['c5',           'с5'],
  ['c3',           'с3'],
  ['partner',      'партнер', 'партнёр'],
  ['berlingo',     'берлинго'],
  ['c-class', 'c class', 'с класс', 'с-класс'],
  ['e-class', 'e class', 'е класс', 'е-класс'],
  ['s-class', 's class', 'с класс'],
  ['a-class', 'a class', 'а класс'],
  ['sprinter',     'спринтер'],
  ['vito',         'вито'],
];

// Build bidirectional lookup: word → [group of synonyms]
const LOOKUP = new Map();
for (const group of SYNONYMS) {
  for (const word of group) {
    LOOKUP.set(word.toLowerCase(), group);
  }
}

// Longest phrases first to avoid partial matches; sorted once at module load
// (expandQuery is called per keystroke and per car during import/augment).
const SORTED_SYNONYMS = SYNONYMS.slice().sort((a, b) => {
  const maxA = Math.max(...a.map(w => w.length));
  const maxB = Math.max(...b.map(w => w.length));
  return maxB - maxA;
});

// Character-level Cyrillic → Latin table (for arbitrary words not in dictionary)
const CYR_TO_LAT = {
  'а':'a','б':'b','в':'v','г':'g','д':'d','е':'e','ё':'yo','ж':'zh',
  'з':'z','и':'i','й':'j','к':'k','л':'l','м':'m','н':'n','о':'o',
  'п':'p','р':'r','с':'s','т':'t','у':'u','ф':'f','х':'kh','ц':'ts',
  'ч':'ch','ш':'sh','щ':'shch','ъ':'','ы':'y','ь':'','э':'e','ю':'yu',
  'я':'ya',
};

const LAT_TO_CYR = {
  'a':'а','b':'б','v':'в','g':'г','d':'д','e':'е','z':'з','i':'и',
  'j':'й','k':'к','l':'л','m':'м','n':'н','o':'о','p':'п','r':'р',
  's':'с','t':'т','u':'у','f':'ф','y':'ы',
};

function cyrToLat(s) {
  return s.toLowerCase().split('').map(c => CYR_TO_LAT[c] ?? c).join('');
}

function latToCyr(s) {
  return s.toLowerCase()
    .replace(/shch/g, 'щ')
    .replace(/kh/g, 'х')
    .replace(/zh/g, 'ж')
    .replace(/ts/g, 'ц')
    .replace(/ch/g, 'ч')
    .replace(/sh/g, 'ш')
    .replace(/yo/g, 'ё')
    .replace(/yu/g, 'ю')
    .replace(/ya/g, 'я')
    .split('').map(c => LAT_TO_CYR[c] ?? c).join('');
}

/**
 * Normalize a string for indexing and search.
 * Lowercases, strips punctuation (keeps digits, letters, spaces), collapses spaces.
 */
export function normalize(s) {
  return (s || '')
    .toLowerCase()
    .replace(/[^\wа-яёa-z0-9\s]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Given a normalized search query, return an array of variant strings:
 * the original + all synonym expansions + character-level translit variants.
 * Used to build the combined tsquery and similarity checks.
 */
export function expandQuery(q) {
  const base = normalize(q);
  const cached = EXPAND_CACHE.get(base);
  if (cached) return cached.slice();

  const variants = new Set([base]);

  // Try to replace known brand/model tokens in the query with all their synonyms
  for (const group of SORTED_SYNONYMS) {
    for (const word of group) {
      const w = word.toLowerCase();
      if (base.includes(w)) {
        // Replace this word with every synonym in the group
        for (const synonym of group) {
          if (synonym.toLowerCase() !== w) {
            variants.add(base.replace(new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), synonym.toLowerCase()));
          }
        }
      }
    }
  }

  // Add character-level translit of the base
  const isMostlyCyrillic = (base.match(/[а-яё]/gi) || []).length > base.length * 0.3;
  if (isMostlyCyrillic) {
    variants.add(cyrToLat(base));
  } else {
    variants.add(latToCyr(base));
  }

  const result = [...variants].filter(Boolean);
  if (EXPAND_CACHE.size >= EXPAND_CACHE_MAX) EXPAND_CACHE.clear();
  EXPAND_CACHE.set(base, result);
  return result.slice();
}

// Typing "ford focus" hits expandQuery once per keystroke with overlapping
// prefixes; augment/import call it once per car. Small memo, wiped when full.
const EXPAND_CACHE = new Map();
const EXPAND_CACHE_MAX = 200;

/**
 * Build the tsvector value for a car record.
 * Returns a SQL expression string using to_tsvector.
 */
export function buildNameFields(brand, model, generation, engineCode, volume, yearFrom, yearTo) {
  const cyrParts = [brand, model, generation].filter(Boolean).map(p => normalize(p));
  const allParts  = [...cyrParts];

  if (engineCode) allParts.push(normalize(engineCode));
  if (volume) allParts.push(String(volume));
  if (yearFrom) allParts.push(String(yearFrom));
  if (yearTo)   allParts.push(String(yearTo));

  const nameNormalized = allParts.join(' ');

  // Build Cyrillic + Latin forms
  const cyrLine = cyrParts.join(' ');
  const latLine = cyrToLat(cyrLine);

  // Expand synonyms for brand+model
  const brandSynonyms = expandQuery(cyrLine).concat(expandQuery(latLine));

  const nameCyrillic  = cyrLine;
  const nameTranslit  = latLine;

  return { nameNormalized, nameCyrillic, nameTranslit, synonymTokens: [...new Set(brandSynonyms)] };
}
