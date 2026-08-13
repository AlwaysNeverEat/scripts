# Словари пасхалки «Вордле»

Два файла, оба — пять русских букв на строку, нижний регистр, «ё» приведена к «е»
(в игре они не различаются).

| Файл | Что это | Размер |
|---|---|---|
| `dictionary.txt` | что принимается как попытка | 25 699 слов |
| `answers.txt` | из чего загадывается слово дня | 915 слов |

## Откуда взято

* `dictionary.txt` — [mediahope/Wordle-Russian-Dictionary](https://github.com/mediahope/Wordle-Russian-Dictionary)
  (`Russian.txt`, все формы пятибуквенных слов), после «ё»→«е» и дедупликации.
* `answers.txt` — пересечение трёх источников:
  1. частотный список [hermitdave/FrequencyWords](https://github.com/hermitdave/FrequencyWords)
     (`content/2018/ru/ru_50k.txt`, 50 тысяч самых частых слов) — берёт на себя
     «известность» слова;
  2. морфология `pymorphy3` — оставляем только НАРИЦАТЕЛЬНЫЕ существительные в
     именительном падеже единственного числа, у которых слово совпадает со своей
     начальной формой (иначе в ответы лезут «места», «семью», «ходом»);
  3. `dictionary.txt` — загаданное обязано приниматься как попытка.

  Сверху — ручной стоп-лист: имена и топонимы, которые морфология не пометила
  («кларк», «пенни», «дюпон»), грамматический мусор («мышей», «целое») и
  матерно-грубое: это рабочий инструмент, а не чат.

## Как пересобрать

```bash
curl -sSLO https://raw.githubusercontent.com/mediahope/Wordle-Russian-Dictionary/main/Russian.txt
curl -sSLO https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/ru/ru_50k.txt
pip install pymorphy3
```

```python
import re, pymorphy3
m = pymorphy3.MorphAnalyzer()
dic = {w.strip().lower().replace('ё','е') for w in open('Russian.txt', encoding='utf-8') if w.strip()}
BAD = {'Name','Surn','Patr','Geox','Orgn','Abbr','Trad','Infr','Arch','Erro','Dist'}
BLOCK = set(open('stop.txt', encoding='utf-8').read().split())  # ручной стоп-лист
ans, seen = [], set()
for line in open('ru_50k.txt', encoding='utf-8'):
    w = line.split()[0].lower()
    k = w.replace('ё','е')
    if len(w) != 5 or not re.fullmatch('[а-яё]{5}', w) or k in seen or k not in dic or k in BLOCK:
        continue
    seen.add(k)
    ps = m.parse(w)
    ok = any(p.tag.POS == 'NOUN' and 'nomn' in p.tag.grammemes and 'sing' in p.tag.grammemes
             and p.normal_form.replace('ё','е') == k and not (BAD & set(p.tag.grammemes)) for p in ps)
    if ok and ps[0].tag.POS == 'NOUN' and not (BAD & set(ps[0].tag.grammemes)):
        ans.append(k)
open('answers.txt','w',encoding='utf-8').write('\n'.join(sorted(ans)) + '\n')
```

Пересобирать не обязательно: слово дня выбирается хэшем от id аккаунта и даты,
и любая правка списка ответов меняет слова у всех разом — лучше делать это
осознанно, а не «заодно».
