import concurrent.futures
import io
import json
import re
import subprocess
import unicodedata
from pathlib import Path
from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / '.cache'
CACHE.mkdir(exist_ok=True)

def fetch(url):
    result = subprocess.run(['curl.exe' if __import__('os').name == 'nt' else 'curl', '-fLsS', '--retry', '2', '--max-time', '35', url], capture_output=True)
    if result.returncode:
        raise RuntimeError(url)
    return result.stdout

def cached(name, url):
    path = CACHE / name
    if not path.exists():
        path.write_bytes(fetch(url))
    return json.loads(path.read_text('utf-8'))

def norm(value):
    return re.sub('[^a-z0-9]', '', unicodedata.normalize('NFKD', value).encode('ascii', 'ignore').decode().lower())

def slug(value):
    return re.sub('[^a-z0-9]+', '-', unicodedata.normalize('NFKD', value).encode('ascii', 'ignore').decode().lower()).strip('-')

TITAN = '''Eren Jaeger|Эрен Йегер|male dark
Mikasa Ackermann|Микаса Аккерман|female dark
Armin Arlelt|Армин Арлерт|male light
Levi Ackermann|Леви Аккерман|male dark
Erwin Smith|Эрвин Смит|male light
Reiner Braun|Райнер Браун|male light
Bertholdt Hoover|Бертольд Гувер|male dark
Annie Leonhart|Энни Леонхарт|female light
Jean Kirschtein|Жан Кирштайн|male light
Conny Springer|Конни Спрингер|male
Sasha Braus|Саша Браус|female dark
Historia Reiss|Хистория Рейсс|female light
Ymir|Имир|female dark
Hange Zoë|Ханджи Зоэ|female dark glasses
Zeke Jaeger|Зик Йегер|male light glasses
Grisha Jaeger|Гриша Йегер|male dark glasses
Gabi Braun|Габи Браун|female dark
Pieck Finger|Пик Фингер|female dark
Porco Galliard|Порко Галлиард|male light
Floch Forster|Флок Форстер|male
Kenny Ackermann|Кенни Аккерман|male dark
Falco Grice|Фалько Грайс|male light
Dot Pyxis|Дот Пиксис|male
Marco Bodt|Марко Ботт|male dark
Petra Rall|Петра Рал|female
Hitch Dreyse|Хитч Дрейс|female light
Marlo Freudenberg|Марло Фройденберг|male dark
Hannes|Ханнес|male light
Carla Jaeger|Карла Йегер|female dark
Rod Reiss|Род Рейсс|male dark
Yelena|Елена|female light
Onyankopon|Оньянкопон|male dark'''
NARUTO = '''Naruto Uzumaki|Наруто Узумаки|male light
Sasuke Uchiha|Саске Учиха|male dark
Sakura Haruno|Сакура Харуно|female
Kakashi Hatake|Какаши Хатакэ|male light
Itachi Uchiha|Итачи Учиха|male dark
Hinata Hyūga|Хината Хьюга|female dark
Gaara|Гаара|male
Rock Lee|Рок Ли|male dark
Shikamaru Nara|Шикамару Нара|male dark
Jiraiya|Джирайя|male light
Tsunade|Цунаде|female light
Orochimaru|Орочимару|male dark
Minato Namikaze|Минато Намикадзе|male light
Madara Uchiha|Мадара Учиха|male dark
Neji Hyūga|Нэджи Хьюга|male dark
Tobirama Senju|Тобирама Сенджу|male light
Obito Uchiha|Обито Учиха|male dark
Might Guy|Майто Гай|male dark
Ino Yamanaka|Ино Яманака|female light
Temari|Темари|female light
Tenten|Тен-Тен|female dark
Deidara|Дейдара|male light
Kisame Hoshigaki|Кисаме Хошигаки|male dark
Sasori|Сасори|male
Sai|Сай|male dark
Kabuto Yakushi|Кабуто Якуши|male light glasses
Hashirama Senju|Хаширама Сенджу|male dark
Kiba Inuzuka|Киба Инузука|male dark
Shino Aburame|Шино Абураме|male dark glasses
Chōji Akimichi|Чоджи Акимичи|male dark
Konan|Конан|female
Killer B|Киллер Би|male light glasses'''
HP = '''Harry Potter|Гарри Поттер
Hermione Granger|Гермиона Грейнджер
Ron Weasley|Рон Уизли
Albus Dumbledore|Альбус Дамблдор
Severus Snape|Северус Снейп
Draco Malfoy|Драко Малфой
Sirius Black|Сириус Блэк
Rubeus Hagrid|Рубеус Хагрид
Luna Lovegood|Полумна Лавгуд
Neville Longbottom|Невилл Долгопупс
Minerva McGonagall|Минерва Макгонагалл
Lord Voldemort|Лорд Волдеморт
Fred Weasley|Фред Уизли
Ginny Weasley|Джинни Уизли
Bellatrix Lestrange|Беллатриса Лестрейндж
Dobby|Добби
Cedric Diggory|Седрик Диггори
Cho Chang|Чжоу Чанг
Remus Lupin|Римус Люпин
Arthur Weasley|Артур Уизли
Horace Slughorn|Гораций Слизнорт
Kingsley Shacklebolt|Кингсли Бруствер
Dolores Umbridge|Долорес Амбридж
Lucius Malfoy|Люциус Малфой
Vincent Crabbe|Винсент Крэбб
Gregory Goyle|Грегори Гойл
Argus Filch|Аргус Филч
Molly Weasley|Молли Уизли
Nymphadora Tonks|Нимфадора Тонкс
James Potter|Джеймс Поттер
Bill Weasley|Билл Уизли
Percy Weasley|Перси Уизли'''
MARVEL = '''Iron Man|Тони Старк
Captain America|Стив Роджерс
Thor|Тор
Hulk|Брюс Беннер
Black Widow|Наташа Романофф
Hawkeye|Клинт Бартон
Nick Fury|Ник Фьюри
Loki|Локи
Thanos|Танос
Spider-Man|Питер Паркер
Doctor Strange|Стивен Стрэндж
Black Panther|Т’Чалла
Scarlet Witch|Ванда Максимофф
Ant-Man II|Скотт Лэнг
Captain Marvel|Кэрол Дэнверс
Groot|Грут
Rocket Raccoon|Ракета
Star-Lord|Звёздный Лорд
Gamora|Гамора
Drax the Destroyer|Дракс
Vision|Вижн
Falcon|Сэм Уилсон
Winter Soldier|Баки Барнс
War Machine|Джеймс Роудс
Wasp|Оса
Quicksilver|Ртуть
Ultron|Альтрон
Deadpool|Дэдпул
Wolverine|Росомаха
Doctor Doom|Доктор Дум
Silver Surfer|Серебряный Сёрфер
Venom|Веном'''

def main():
    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
        pages = list(pool.map(lambda n: cached(f'titan-page-{n}.json', f'https://api.attackontitanapi.com/characters?page={n}'), range(1, 12)))
    titan = [c for page in pages for c in page['results']]
    naruto = cached('narutodb.json', 'https://dattebayo-api.onrender.com/characters?limit=100')['characters']
    naruto_extra = cached('naruto-data.json', 'https://raw.githubusercontent.com/muhammadpauzi/naruto-api/main/data.json')
    hp = cached('hp.json', 'https://hp-api.onrender.com/api/characters')
    hp_extra = cached('potter-extra.json', 'https://potterapi-fedeperin.vercel.app/en/characters')
    marvel = cached('marvel.json', 'https://raw.githubusercontent.com/akabab/superhero-api/master/api/all.json')
    original = json.loads((ROOT / 'tools/sources.json').read_text('utf-8'))
    specs = [('attack-on-titan', 'Атака титанов', 'Attack on Titan', 'За пределами стен', 'Beyond the walls', '#8da99b', TITAN), ('naruto', 'Наруто', 'Naruto', 'Твой путь ниндзя', 'Your ninja way', '#dd955c', NARUTO), ('harry-potter', 'Гарри Поттер', 'Harry Potter', 'Магия в каждом вопросе', 'A little question of magic', '#ab92c5', HP), ('avengers', 'Мстители', 'Avengers', 'Герои среди нас', 'Heroes among us', '#7ca7c5', MARVEL)]
    categories = []
    sources = []
    jobs = []
    for cid, ru, en, sub, suben, color, names in specs:
        cat = dict(id=cid, title=ru, titleEn=en, subtitle=sub, subtitleEn=suben, color=color, characters=[])
        for line in names.splitlines():
            parts = line.split('|'); name, name_ru = parts[:2]; traits = parts[2].split() if len(parts) > 2 else []
            url = None
            if cid == 'attack-on-titan':
                match = next((x for x in titan if norm(x['name']) == norm(name)), None)
                url = match['img'] if match else original.get(name_ru)
            elif cid == 'naruto':
                match = next((x for x in naruto if norm(x['name']) == norm(name)), None)
                if match:
                    url = match['images'][-1]
                else:
                    match = next((x for x in naruto_extra if norm(name) in norm(x['name']) or norm(name.split()[0]) in norm(x['picture'])), None)
                    url = match['picture'] if match else None
            elif cid == 'harry-potter':
                match = next((x for x in hp if norm(x['name']) == norm(name)), None)
                url = match['image'] if match else None
                if match:
                    traits = [match['gender']]
                    hair = match.get('hairColour', '')
                    if hair in ['black', 'brown', 'dark']: traits.append('dark')
                    if hair in ['blonde', 'blond', 'white', 'grey']: traits.append('light')
                if not url:
                    extra = next((x for x in hp_extra if norm(name.split()[0]) in norm(x['fullName']) and norm(name.split()[-1]) in norm(x['fullName'])), None)
                    url = extra['image'] if extra else None
                if name in ['Harry Potter','Albus Dumbledore','Minerva McGonagall','Arthur Weasley','James Potter','Percy Weasley']: traits.append('glasses')
                if not traits: traits = ['female' if name in ['Molly Weasley','Nymphadora Tonks'] else 'male']
            else:
                matches = [x for x in marvel if x['name'] == name and x['biography'].get('publisher') == 'Marvel Comics']
                match = matches[0] if matches else next((x for x in marvel if x['name'] == name), None)
                if name == 'Captain Marvel': match = next(x for x in marvel if x['biography']['fullName'] == 'Carol Danvers')
                url = match['images']['lg'] if match else None
                if match:
                    traits = [match['appearance']['gender'].lower()]
                    hair = match['appearance']['hairColor'].lower()
                    if hair in ['black','brown']: traits.append('dark')
                    if hair in ['blond','white','silver']: traits.append('light')
            if name == 'Dobby':
                url = 'https://media.harrypotterfanzone.com/dobby-in-malfoy-manor.jpg'
                traits = ['male']
            if not url: raise RuntimeError(f'Missing source: {cid} {name}')
            if name == 'Jiraiya': url = 'https://static.wikia.nocookie.net/naruto/images/2/21/Profile_Jiraiya.PNG'
            if name == 'Neji Hyūga': url = 'https://static.wikia.nocookie.net/naruto/images/a/a8/Neji_Part_II.png'
            char_id = cid + '-' + slug(name)
            path = f'/images/{cid}/{slug(name)}.webp'
            cat['characters'].append(dict(id=char_id, name=name_ru, nameEn=name, img=path, traits=traits))
            sources.append(dict(id=char_id, name=name, source=url, file=path))
            jobs.append((url, ROOT / 'public' / path.lstrip('/')))
        categories.append(cat)
    def download(job):
        url, path = job
        if path.exists(): return str(path.name)
        body = fetch(url)
        image = Image.open(io.BytesIO(body)).convert('RGB')
        if image.width < 50 or image.height < 50: raise RuntimeError(f'Image too small: {url}')
        image = ImageOps.fit(image, (360, 440), method=Image.Resampling.LANCZOS, centering=(.5, .35))
        path.parent.mkdir(parents=True, exist_ok=True)
        image.save(path, 'WEBP', quality=83, method=6)
        return path.name
    failed = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        futures = {pool.submit(download, job): job for job in jobs}
        for future in concurrent.futures.as_completed(futures):
            try: print('OK', future.result(), flush=True)
            except Exception as error: failed.append(str(error)); print('FAIL', str(error), flush=True)
    (ROOT / 'src/data').mkdir(parents=True, exist_ok=True)
    (ROOT / 'src/data/catalog.json').write_text(json.dumps(categories, ensure_ascii=False, indent=2), 'utf-8')
    (ROOT / 'data/asset-sources.json').write_text(json.dumps(sources, ensure_ascii=False, indent=2), 'utf-8')
    rows = ',\n'.join("('%s','%s')" % (c['id'], cat['id']) for cat in categories for c in cat['characters'])
    (ROOT / 'supabase/migrations/202610110002_characters.sql').write_text('insert into game_private.characters(id, category) values\n' + rows + '\non conflict (id) do nothing;\n', 'utf-8')
    print('TOTAL', len(jobs), 'FAILED', len(failed))
    if failed: raise SystemExit(1)

if __name__ == '__main__':
    main()
