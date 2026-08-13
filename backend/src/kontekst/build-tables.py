#!/usr/bin/env python3
# Сборка таблиц пасхалки «Контекстно» (см. README.md рядом).
#
# На выходе четыре файла, которые и едут на прод; ни модели, ни Python на
# сервере не нужно — бэкенд читает готовые байты.
#
#   vocab.txt     — словарь принимаемых слов, порядок строк = id слова
#   answers.txt   — из чего загадывается, порядок строк = номер таблицы в ranks.bin
#   ranks.bin     — uint16 LE, answers × vocab: ранг слова к этому ответу (1 = ответ)
#   forms.txt.gz  — «словоформа лемма» построчно, чтобы принимать «машиной»
#
# Запуск (модель качается отдельно, 193 МБ):
#   curl -sSLO https://rusvectores.org/static/models/rusvectores4/araneum/araneum_upos_skipgram_300_2_2018.vec.gz
#   pip install numpy pymorphy3
#   python3 build-tables.py araneum_upos_skipgram_300_2_2018.vec.gz
#
# Пересобирать без нужды не стоит: другой словарь — другие ранги у ВСЕХ
# аккаунтов разом.

import gzip
import re
import sys
from pathlib import Path

import numpy as np
import pymorphy3

HERE = Path(__file__).resolve().parent
VOCAB_SIZE = 30_000     # больше не нужно: дальше идут слова, которых никто не знает
ANSWERS_SIZE = 366      # год слов; каждому аккаунту достаётся своё
WORD_RE = re.compile(r'^[а-я]{3,}$')

# Модель обучена на веб-корпусе — мат, порнография и наркотики в ней есть.
# Это рабочий инструмент, а не чат: такие слова не должны ни загадываться, ни
# лезть в подсказки «ближайших».
BLOCK = set('''
хуй хер хрен пизда манда елда залупа мудак долбоеб пидор пидорас гомик педик
шлюха проститутка блядь блядина сучка сука мразь гнида падла говно дерьмо
жопа задница срач моча понос рвота блевотина сперма минет анус вагина пенис
член секс порно порнуха эротика оргазм оргия мастурбация презерватив дилдо
трах ебля наркотик героин кокаин гашиш марихуана конопля травка амфетамин
метадон нарк наркоман нарколыга алкаш алкоголик синяк бухло водяра
негр жид хохол москаль чурка нацист фашист терракт теракт убийство изнасилование
'''.split())

# Служебный/абстрактный верх частотного списка — как ответы такие слова
# бессмысленны («вид», «случай»), а в словаре пусть остаются.
NOT_AN_ANSWER = set('''
год время день вид случай дело возможность часть качество помощь количество
результат условие данные использование образ отношение состояние процесс
статья информация услуга работа система вопрос область счет ряд число уровень
основа течение сторона мера срок цель задача форма способ вариант тип
'''.split())


def load_nouns(model_path):
    """Существительные модели в порядке частотности: {слово: вектор}."""
    words, vecs = [], []
    with gzip.open(model_path, 'rt', encoding='utf-8') as f:
        f.readline()  # «196620 300»
        for line in f:
            parts = line.rstrip().split(' ')
            token = parts[0]
            if not token.endswith('_NOUN'):
                continue
            words.append(token[:-len('_NOUN')])
            vecs.append(np.asarray(parts[1:], dtype=np.float32))
    return words, np.vstack(vecs)


def clean(words, vectors, morph):
    """Оставляем нарицательные существительные в начальной форме.

    Без этого в словарь лезут обрывки («машин», «трас»), имена и топонимы
    («серега», «москва») и латиница из веб-корпуса. Сомнительное слово в
    словаре хуже отсутствующего: игрок будет считать, что промахнулся он.

    is_known отсекает то, что морфология не знает, а лишь угадала по концовке:
    «груп», «обьяснение», «витрум». Заодно уходят сросшиеся сокращения вроде
    «спецгруппа» — их всё равно никто бы не назвал, а в списке ближайших слов
    они смотрелись бы опечаткой.
    """
    bad_tags = {'Name', 'Surn', 'Patr', 'Geox', 'Orgn', 'Abbr'}
    keep_words, keep_rows = [], []
    for i, w in enumerate(words):
        if not WORD_RE.fullmatch(w) or w in BLOCK:
            continue
        parses = morph.parse(w)
        # normal_form сверяем без «ё»: в модели она везде заменена на «е», и
        # иначе из словаря выпадают «ребенок», «елка», «звезды» — самые
        # обычные слова, которые игрок назовёт первыми.
        ok = any(p.is_known and p.tag.POS == 'NOUN' and 'nomn' in p.tag.grammemes
                 and p.normal_form.replace('ё', 'е') == w
                 and not (bad_tags & set(p.tag.grammemes))
                 for p in parses)
        if not ok or (bad_tags & set(parses[0].tag.grammemes)):
            continue
        keep_words.append(w)
        keep_rows.append(i)
        if len(keep_words) >= VOCAB_SIZE:
            break
    return keep_words, vectors[keep_rows]


def build_ranks(vectors, answer_ids):
    """ranks[a][w] — какое место занимает слово w по близости к ответу a."""
    unit = vectors / np.linalg.norm(vectors, axis=1, keepdims=True)
    table = np.empty((len(answer_ids), len(vectors)), dtype=np.uint16)
    for row, wid in enumerate(answer_ids):
        order = np.argsort(-(unit @ unit[wid]), kind='stable')
        # order[k] — слово на k-м месте; нам нужно обратное отображение,
        # чтобы ранг доставался по id слова за одно чтение.
        table[row, order] = np.arange(1, len(vectors) + 1, dtype=np.uint16)
    return table


def build_forms(words, morph):
    """«машиной→машина»: все формы слов словаря, «ё» приведена к «е»."""
    pairs = {}
    for lemma in words:
        parses = [p for p in morph.parse(lemma)
                  if p.tag.POS == 'NOUN' and p.normal_form.replace('ё', 'е') == lemma]
        if not parses:
            continue
        for form in parses[0].lexeme:
            pairs.setdefault(form.word.replace('ё', 'е'), lemma)
    # Сама лемма важнее любой чужой словоформы, совпавшей по написанию.
    for lemma in words:
        pairs[lemma] = lemma
    return pairs


def main():
    if len(sys.argv) < 2:
        sys.exit('укажите путь к .vec.gz модели RusVectores')
    morph = pymorphy3.MorphAnalyzer()

    print('читаю модель…')
    words, vectors = load_nouns(sys.argv[1])
    print(f'  существительных в модели: {len(words)}')

    print('чищу словарь…')
    words, vectors = clean(words, vectors, morph)
    print(f'  осталось: {len(words)}')

    answers = [w for w in words if w not in NOT_AN_ANSWER][:ANSWERS_SIZE]
    index = {w: i for i, w in enumerate(words)}
    print(f'  ответов: {len(answers)}')

    print('считаю ранги…')
    table = build_ranks(vectors, [index[w] for w in answers])

    print('собираю словоформы…')
    forms = build_forms(words, morph)
    print(f'  пар: {len(forms)}')

    (HERE / 'vocab.txt').write_text('\n'.join(words) + '\n', encoding='utf-8')
    (HERE / 'answers.txt').write_text('\n'.join(answers) + '\n', encoding='utf-8')
    (HERE / 'ranks.bin').write_bytes(table.astype('<u2').tobytes())
    (HERE / 'forms.txt.gz').write_bytes(gzip.compress(
        ('\n'.join(f'{k} {v}' for k, v in sorted(forms.items())) + '\n').encode('utf-8'), 9))
    print(f'готово: ranks.bin {table.nbytes / 1e6:.1f} МБ')


if __name__ == '__main__':
    main()
