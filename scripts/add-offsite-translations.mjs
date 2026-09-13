/**
 * add-offsite-translations.mjs
 * Adds the 3 off-device backup keys to every locale missing them.
 * Idempotent: skips locales that already have all 3 keys.
 * Usage: node scripts/add-offsite-translations.mjs
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const LOCALES_DIR = "public/locales";

/** The 3 new keys, fully translated per locale. EN and ES already shipped. */
const T = {
  ar: {
    app_bmfKitOffDeviceWarning:
      "مهم: لا تُبقِ الملف على هذا الجهاز فقط. انسخه إلى مكان ثانٍ — تخزين سحابي (Google Drive أو Dropbox) أو وحدة USB أو أرسله إلى بريدك. إذا تعطّل هذا الجهاز فستضيع النسخة الموجودة عليه أيضًا.",
    app_vault_offsite_note:
      "موصى به: احتفظ بنسخة احتياطية واحدة على الأقل خارج هذا الجهاز (سحابة أو USB أو بريد إلكتروني). خزنتك تعيش في هذا المتصفح فقط.",
    backup_offsiteRule:
      "القاعدة الذهبية: النسخة على نفس الجهاز ليست نسخة احتياطية. احتفظ بنسخ في مكانين على الأقل — مثلًا التخزين السحابي (Google Drive أو Dropbox أو OneDrive) ووحدة USB، أو أرسل الملف إلى بريدك الإلكتروني.",
  },
  bg: {
    app_bmfKitOffDeviceWarning:
      "Важно: не съхранявайте файла само на това устройство. Копирайте го на второ място — облачно хранилище (Google Drive, Dropbox), USB памет или го изпратете на имейла си. Ако устройството се повреди, копието върху него също ще изгубите.",
    app_vault_offsite_note:
      "Препоръчително: пазете поне едно резервно копие извън това устройство (облак, USB или имейл). Хранилището ви съществува само в този браузър.",
    backup_offsiteRule:
      "Златно правило: копие на същото устройство не е резервно копие. Пазете копия поне на две места — например в облака (Google Drive, Dropbox, OneDrive) и на USB, или изпратете файла на имейла си.",
  },
  cs: {
    app_bmfKitOffDeviceWarning:
      "Důležité: neuchovávejte soubor jen v tomto zařízení. Zkopírujte ho na druhé místo — cloudové úložiště (Google Drive, Dropbox), USB klíčenku, nebo si ho pošlete e-mailem. Pokud zařízení selže, ztratíte i kopii na něm.",
    app_vault_offsite_note:
      "Doporučeno: mějte alespoň jednu zálohu mimo toto zařízení (cloud, USB nebo e-mail). Vaše trezor žije pouze v tomto prohlížeči.",
    backup_offsiteRule:
      "Zlaté pravidlo: kopie na stejném zařízení není záloha. Uchovávejte kopie alespoň na dvou místech — např. v cloudu (Google Drive, Dropbox, OneDrive) a na USB, nebo si soubor pošlete e-mailem.",
  },
  da: {
    app_bmfKitOffDeviceWarning:
      "Vigtigt: Opbevar ikke filen kun på denne enhed. Kopiér den til et andet sted — cloudlager (Google Drive, Dropbox), en USB-nøgle, eller send den til dig selv pr. e-mail. går enheden i stykker, går kopien på den også tabt.",
    app_vault_offsite_note:
      "Anbefalet: Hav mindst én sikkerhedskopi uden for denne enhed (cloud, USB eller e-mail). Din boks lever kun i denne browser.",
    backup_offsiteRule:
      "Gyldne regel: En kopi på samme enhed er ikke en sikkerhedskopi. Opbevar kopier mindst to steder — f.eks. cloudlager (Google Drive, Dropbox, OneDrive) og en USB-nøgle, eller send filen til dig selv pr. e-mail.",
  },
  de: {
    app_bmfKitOffDeviceWarning:
      "Wichtig: Bewahren Sie die Datei nicht nur auf diesem Gerät auf. Kopieren Sie sie an einen zweiten Ort — Cloud-Speicher (Google Drive, Dropbox), einen USB-Stick oder senden Sie sie sich selbst per E-Mail. Geht das Gerät kaputt, ist die Kopie darauf auch verloren.",
    app_vault_offsite_note:
      "Empfohlen: Bewahren Sie mindestens eine Sicherungskopie außerhalb dieses Geräts auf (Cloud, USB oder E-Mail). Ihr Tresor lebt nur in diesem Browser.",
    backup_offsiteRule:
      "Goldene Regel: Eine Kopie auf demselben Gerät ist kein Backup. Bewahren Sie Kopien an mindestens zwei Orten auf — z. B. Cloud-Speicher (Google Drive, Dropbox, OneDrive) und einem USB-Stick, oder senden Sie sich die Datei per E-Mail.",
  },
  el: {
    app_bmfKitOffDeviceWarning:
      "Σημαντικό: Μην κρατάτε το αρχείο μόνο σε αυτή τη συσκευή. Αντιγράψτε το σε δεύτερο σημείο — αποθήκευση στο νέφος (Google Drive, Dropbox), σε USB, ή στείλτε το στον εαυτό σας με email. Αν η συσκευή χαλάσει, χάνεται και το αντίγραφο πάνω της.",
    app_vault_offsite_note:
      "Συνιστάται: Κρατήστε τουλάχιστον ένα αντίγραφο ασφαλείας εκτός αυτής της συσκευής (νέφος, USB ή email). Το θησαυροφύλαξά σας ζει μόνο σε αυτόν τον browser.",
    backup_offsiteRule:
      "Χρυσός κανόνας: Ένα αντίγραφο στην ίδια συσκευή δεν είναι backup. Κρατήστε αντίγραφα σε τουλάχιστον δύο σημεία — π.χ. στο νέφος (Google Drive, Dropbox, OneDrive) και σε USB, ή στείλτε το αρχείο στον εαυτό σας με email.",
  },
  fi: {
    app_bmfKitOffDeviceWarning:
      "Tärkeää: Älä säilytä tiedostoa vain tällä laitteella. Kopioi se toiseen paikkaan — pilvitallennus (Google Drive, Dropbox), USB-muisti tai lähetä se itsellesi sähköpostitse. Jos laite hajoaa, myös kopio siinä häviää.",
    app_vault_offsite_note:
      "Suositus: Pidä vähintään yksi varmuuskopio tämän laitteen ulkopuolella (pilvi, USB tai sähköposti). Holvisi elää vain tässä selaimessa.",
    backup_offsiteRule:
      "Kultainen sääntö: Kopio samalla laitteella ei ole varmuuskopio. Pidä kopiot vähintään kahdessa paikassa — esim. pilvessä (Google Drive, Dropbox, OneDrive) ja USB-muistissa, tai lähetä tiedosto itsellesi sähköpostitse.",
  },
  fr: {
    app_bmfKitOffDeviceWarning:
      "Important : ne conservez pas le fichier uniquement sur cet appareil. Copiez-le vers un second emplacement — stockage cloud (Google Drive, Dropbox), clé USB, ou envoyez-le-vous par e-mail. Si l'appareil tombe en panne, la copie qui s'y trouve est perdue aussi.",
    app_vault_offsite_note:
      "Recommandé : gardez au moins une copie de sauvegarde hors de cet appareil (cloud, USB ou e-mail). Votre coffre ne vit que dans ce navigateur.",
    backup_offsiteRule:
      "Règle d'or : une copie sur le même appareil n'est pas une sauvegarde. Conservez des copies dans au moins deux endroits — p. ex. le cloud (Google Drive, Dropbox, OneDrive) et une clé USB, ou envoyez-vous le fichier par e-mail.",
  },
  he: {
    app_bmfKitOffDeviceWarning:
      "חשוב: אל תשאירו את הקובץ במכשיר הזה בלבד. העתיקו אותו למקום שני — אחסון ענן (Google Drive, Dropbox), כונן USB, או שלחו אותו לעצמכם במייל. אם המכשיר ייכשל, העותק שעליו ייעלם גם כן.",
    app_vault_offsite_note:
      "מומלץ: שמרו לפחות עותק גיבוי אחד מחוץ למכשיר הזה (ענן, USB או מייל). הכספת שלכם חיה רק בדפדפן הזה.",
    backup_offsiteRule:
      "כלל הזהב: עותק באותו מכשיר אינו גיבוי. שמרו עותקים בשני מקומות לפחות — למשל אחסון ענן (Google Drive, Dropbox, OneDrive) וכונן USB, או שלחו את הקובץ לעצמכם במייל.",
  },
  hi: {
    app_bmfKitOffDeviceWarning:
      "महत्वपूर्ण: फ़ाइल को केवल इसी डिवाइस पर न रखें। इसे किसी दूसरी जगह कॉपी करें — क्लाउड स्टोरेज (Google Drive, Dropbox), USB ड्राइव, या खुद को ईमेल कर लें। यह डिवाइस खराब होने पर उस पर रखी कॉपी भी खो जाएगी।",
    app_vault_offsite_note:
      "अनुशंसित: इस डिवाइस के बाहर कम से कम एक बैकअप कॉपी रखें (क्लाउड, USB या ईमेल)। आपका वॉल्ट केवल इसी ब्राउज़र में रहता है।",
    backup_offsiteRule:
      "सुनहरा नियम: उसी डिवाइस पर रखी कॉपी बैकअप नहीं है। कॉपियाँ कम से कम दो जगहों पर रखें — जैसे क्लाउड (Google Drive, Dropbox, OneDrive) और USB ड्राइव, या फ़ाइल खुद को ईमेल कर लें।",
  },
  hr: {
    app_bmfKitOffDeviceWarning:
      "Važno: ne čuvajte datoteku samo na ovom uređaju. Kopirajte je na drugo mjesto — cloud pohranu (Google Drive, Dropbox), USB ključ, ili je pošaljite sebi e-poštom. Ako uređaj otkaže, izgubit ćete i kopiju na njemu.",
    app_vault_offsite_note:
      "Preporučeno: imajte barem jednu sigurnosnu kopiju izvan ovog uređaja (oblak, USB ili e-pošta). Vaše se trezore živi samo u ovom pregledniku.",
    backup_offsiteRule:
      "Zlatno pravilo: kopija na istom uređaju nije sigurnosna kopija. Čuvajte kopije na najmanje dva mjesta — npr. u oblaku (Google Drive, Dropbox, OneDrive) i na USB ključu, ili datoteku pošaljite sebi e-poštom.",
  },
  hu: {
    app_bmfKitOffDeviceWarning:
      "Fontos: ne tárolja a fájlt csak ezen az eszközön. Másolja egy második helyre — felhőtarhely (Google Drive, Dropbox), USB-meghajtó, vagy küldje el magának e-mailben. Ha az eszköz tönkremegy, a rajta lévő másolat is elveszik.",
    app_vault_offsite_note:
      "Ajánlott: tartsan legalább egy biztonsági másolatot ezen az eszközön kívül (felhő, USB vagy e-mail). A széfje csak ebben a böngészőben él.",
    backup_offsiteRule:
      "Aranyszabály: az ugyanazon az eszközön lévő másolat nem biztonsági mentés. Tartsa a másolatokat legalább két helyen — pl. felhőben (Google Drive, Dropbox, OneDrive) és USB-meghajtón, vagy küldje el magának a fájlt e-mailben.",
  },
  id: {
    app_bmfKitOffDeviceWarning:
      "Penting: jangan simpan berkas hanya di perangkat ini. Salin ke tempat kedua — penyimpanan awan (Google Drive, Dropbox), drive USB, atau kirimkan ke email Anda sendiri. Jika perangkat ini rusak, salinan di dalamnya juga hilang.",
    app_vault_offsite_note:
      "Direkomendasikan: simpan setidaknya satu salinan cadangan di luar perangkat ini (awan, USB, atau email). Brankas Anda hanya hidup di peramban ini.",
    backup_offsiteRule:
      "Aturan emas: salinan di perangkat yang sama bukanlah cadangan. Simpan salinan di setidaknya dua tempat — mis. penyimpanan awan (Google Drive, Dropbox, OneDrive) dan drive USB, atau kirimkan berkas ke email Anda.",
  },
  it: {
    app_bmfKitOffDeviceWarning:
      "Importante: non conservare il file solo su questo dispositivo. Copialo in un secondo luogo — archiviazione cloud (Google Drive, Dropbox), chiavetta USB, o inviatielo via email. Se il dispositivo si rompe, si perde anche la copia che contiene.",
    app_vault_offsite_note:
      "Consigliato: tieni almeno una copia di backup fuori da questo dispositivo (cloud, USB o email). Il tuo caveau vive solo in questo browser.",
    backup_offsiteRule:
      "Regola d'oro: una copia sullo stesso dispositivo non è un backup. Conserva copie in almeno due posti — es. cloud (Google Drive, Dropbox, OneDrive) e chiavetta USB, o inviati il file via email.",
  },
  ja: {
    app_bmfKitOffDeviceWarning:
      "重要：このファイルをこの端末だけに保管しないでください。別の場所にもコピーしてください — クラウドストレージ（Google Drive、Dropbox）、USB メモリ、またはご自身のメールアドレスに送信。端末が故障すると、その中のコピーも失われます。",
    app_vault_offsite_note:
      "推奨：少なくとも 1 つのバックアップをこの端末の外に保管してください（クラウド、USB、メール）。あなたの保管庫はこのブラウザの中にのみ存在します。",
    backup_offsiteRule:
      "黄金律：同じ端末にあるコピーはバックアップではありません。少なくとも 2 箇所にコピーを保管してください — 例：クラウド（Google Drive、Dropbox、OneDrive）と USB メモリ、またはファイルをご自身にメールで送る。",
  },
  ko: {
    app_bmfKitOffDeviceWarning:
      "중요: 파일을 이 기기에만 보관하지 마세요. 다른 곳에도 복사하세요 — 클라우드 저장소(Google Drive, Dropbox), USB 드라이브, 또는 자신에게 이메일로 보내기. 기기가 고장 나면 그 안의 사본도 사라집니다.",
    app_vault_offsite_note:
      "권장: 이 기기 밖에 최소 하나의 백업 사본을 보관하세요(클라우드, USB 또는 이메일). 보관함은 이 브라우저에만 존재합니다.",
    backup_offsiteRule:
      "황금 법칙: 같은 기기에 있는 사본은 백업이 아닙니다. 최소 두 곳에 사본을 보관하세요 — 예: 클라우드(Google Drive, Dropbox, OneDrive)와 USB 드라이브, 또는 파일을 자신에게 이메일로 보내기.",
  },
  nl: {
    app_bmfKitOffDeviceWarning:
      "Belangrijk: bewaar het bestand niet alleen op dit apparaat. Kopieer het naar een tweede plek — cloudopslag (Google Drive, Dropbox), een USB-stick, of mail het naar jezelf. Gaat het apparaat kapot, dan gaat de kopie erop ook verloren.",
    app_vault_offsite_note:
      "Aanbevolen: bewaar minstens één back-upkopie buiten dit apparaat (cloud, USB of e-mail). Je kluis leeft alleen in deze browser.",
    backup_offsiteRule:
      "Gouden regel: een kopie op hetzelfde apparaat is geen back-up. Bewaar kopieën op minstens twee plekken — bijv. cloudopslag (Google Drive, Dropbox, OneDrive) en een USB-stick, of mail het bestand naar jezelf.",
  },
  no: {
    app_bmfKitOffDeviceWarning:
      "Viktig: Ikke oppbevar filen kun på denne enheten. Kopier den til et annet sted — skylager (Google Drive, Dropbox), en USB-pinne, eller send den til deg selv på e-post. Går enheten i stykker, går kopien der også tapt.",
    app_vault_offsite_note:
      "Anbefalt: Ha minst én sikkerhetskopi utenfor denne enheten (sky, USB eller e-post). Boksen din lever bare i denne nettleseren.",
    backup_offsiteRule:
      "Gylne regel: En kopi på samme enhet er ikke en sikkerhetskopi. Oppbevar kopier på minst to steder — f.eks. skylager (Google Drive, Dropbox, OneDrive) og en USB-pinne, eller send filen til deg selv på e-post.",
  },
  pl: {
    app_bmfKitOffDeviceWarning:
      "Ważne: nie przechowuj pliku tylko na tym urządzeniu. Skopiuj go w drugie miejsce — pamięć w chmurze (Google Drive, Dropbox), pendrive USB, lub wyślij go sobie e-mailem. Jeśli urządzenie ulegnie awarii, kopia na nim również przepadnie.",
    app_vault_offsite_note:
      "Zalecane: przechowuj co najmniej jedną kopię zapasową poza tym urządzeniem (chmura, USB lub e-mail). Twój sejf żyje tylko w tej przeglądarce.",
    backup_offsiteRule:
      "Złota zasada: kopia na tym samym urządzeniu to nie kopia zapasowa. Przechowuj kopie w co najmniej dwóch miejscach — np. w chmurze (Google Drive, Dropbox, OneDrive) i na pendrive, lub wyślij plik sobie e-mailem.",
  },
  pt: {
    app_bmfKitOffDeviceWarning:
      "Importante: não guarde o ficheiro apenas neste dispositivo. Copie-o para um segundo local — armazenamento na nuvem (Google Drive, Dropbox), uma pen USB, ou envie-o para o seu próprio e-mail. Se o dispositivo avariar, a cópia nele também se perde.",
    app_vault_offsite_note:
      "Recomendado: mantenha pelo menos uma cópia de segurança fora deste dispositivo (nuvem, USB ou e-mail). O seu cofre vive apenas neste navegador.",
    backup_offsiteRule:
      "Regra de ouro: uma cópia no mesmo dispositivo não é uma cópia de segurança. Guarde cópias em pelo menos dois lugares — p. ex. na nuvem (Google Drive, Dropbox, OneDrive) e numa pen USB, ou envie o ficheiro para o seu e-mail.",
  },
  ro: {
    app_bmfKitOffDeviceWarning:
      "Important: nu păstrați fișierul doar pe acest dispozitiv. Copiați-l într-un al doilea loc — stocare în cloud (Google Drive, Dropbox), stick USB, sau trimiteți-vă-l pe e-mail. Dacă dispozitivul cedează, copia de pe el se pierde și ea.",
    app_vault_offsite_note:
      "Recomandat: păstrați cel puțin o copie de rezervă în afara acestui dispozitiv (cloud, USB sau e-mail). Seiful dvs. trăiește doar în acest browser.",
    backup_offsiteRule:
      "Regula de aur: o copie pe același dispozitiv nu este o copie de rezervă. Păstrați copii în cel puțin două locuri — de ex. în cloud (Google Drive, Dropbox, OneDrive) și pe un stick USB, sau trimiteți-vă fișierul pe e-mail.",
  },
  ru: {
    app_bmfKitOffDeviceWarning:
      "Важно: не храните файл только на этом устройстве. Скопируйте его во второе место — облачное хранилище (Google Drive, Dropbox), USB-накопитель или отправьте себе по почте. Если устройство выйдет из строя, копия на нём тоже пропадёт.",
    app_vault_offsite_note:
      "Рекомендуется: храните хотя бы одну резервную копию вне этого устройства (облако, USB или почта). Ваше хранилище живёт только в этом браузере.",
    backup_offsiteRule:
      "Золотое правило: копия на том же устройстве — это не резервная копия. Храните копии минимум в двух местах — например, в облаке (Google Drive, Dropbox, OneDrive) и на USB-накопителе, или отправьте файл себе по почте.",
  },
  sv: {
    app_bmfKitOffDeviceWarning:
      "Viktigt: Förvara inte filen endast på den här enheten. Kopiera den till en andra plats — molnlagring (Google Drive, Dropbox), ett USB-minne, eller maila den till dig själv. Går enheten sönder försvinner kopian på den också.",
    app_vault_offsite_note:
      "Rekommenderat: ha minst en säkerhetskopia utanför den här enheten (moln, USB eller e-post). Ditt valv lever bara i den här webbläsaren.",
    backup_offsiteRule:
      "Gyllene regeln: en kopia på samma enhet är ingen säkerhetskopia. Förvara kopior på minst två ställen — t.ex. molnlagring (Google Drive, Dropbox, OneDrive) och ett USB-minne, eller maila filen till dig själv.",
  },
  th: {
    app_bmfKitOffDeviceWarning:
      "สำคัญ: อย่าเก็บไฟล์ไว้บนอุปกรณ์นี้เพียงที่เดียว คัดลอกไปยังที่สอง — คลาวด์ (Google Drive, Dropbox) แฟลชไดรฟ์ USB หรือส่งไปที่อีเมลของตัวเอง หากอุปกรณ์เสีย สำเนาที่อยู่ข้างในจะหายไปด้วย",
    app_vault_offsite_note:
      "แนะนำ: เก็บสำรองไว้อย่างน้อยหนึ่งชุดนอกอุปกรณ์นี้ (คลาวด์ USB หรืออีเมล) ตู้เซฟของคุณมีชีวิตอยู่ในเบราว์เซอร์นี้เท่านั้น",
    backup_offsiteRule:
      "กฎทอง: สำเนาบนอุปกรณ์เดียวกันไม่ใช่การสำรองข้อมูล เก็บสำเนาไว้อย่างน้อยสองที่ — เช่น คลาวด์ (Google Drive, Dropbox, OneDrive) และแฟลชไดรฟ์ USB หรือส่งไฟล์ไปที่อีเมลของตัวเอง",
  },
  tr: {
    app_bmfKitOffDeviceWarning:
      "Önemli: Dosyayı yalnızca bu cihazda saklamayın. Onu ikinci bir yere kopyalayın — bulut depolama (Google Drive, Dropbox), USB bellek veya kendinize e-postayla gönderin. Cihaz bozulursa üzerindeki kopya da kaybolur.",
    app_vault_offsite_note:
      "Önerilen: en az bir yedek kopyayı bu cihazın dışında tutun (bulut, USB veya e-posta). Kasanız yalnızca bu tarayıcıda yaşar.",
    backup_offsiteRule:
      "Altın kural: aynı cihazdaki kopya yedek değildir. Kopyaları en az iki yerde tutun — örn. bulut depolama (Google Drive, Dropbox, OneDrive) ve USB bellek, veya dosyayı kendinize e-postayla gönderin.",
  },
  uk: {
    app_bmfKitOffDeviceWarning:
      "Важливо: не зберігайте файл лише на цьому пристрої. Скопіюйте його в друге місце — хмарне сховище (Google Drive, Dropbox), USB-накопичувач або надішліть собі поштою. Якщо пристрій вийде з ладу, копія на ньому теж зникне.",
    app_vault_offsite_note:
      "Рекомендовано: зберігайте принаймні одну резервну копію поза цим пристроєм (хмара, USB або пошта). Ваше сховище живе лише в цьому браузері.",
    backup_offsiteRule:
      "Золоте правило: копія на тому самому пристрої — це не резервна копія. Зберігайте копії щонайменше у двох місцях — наприклад, у хмарі (Google Drive, Dropbox, OneDrive) і на USB-накопичувачі, або надішліть файл собі поштою.",
  },
  vi: {
    app_bmfKitOffDeviceWarning:
      "Quan trọng: đừng chỉ giữ tệp trên thiết bị này. Hãy sao chép sang nơi thứ hai — lưu trữ đám mây (Google Drive, Dropbox), USB, hoặc tự gửi qua email. Nếu thiết bị hỏng, bản sao trong đó cũng mất theo.",
    app_vault_offsite_note:
      "Khuyến nghị: giữ ít nhất một bản sao lưu ngoài thiết bị này (đám mây, USB hoặc email). Két của bạn chỉ tồn tại trong trình duyệt này.",
    backup_offsiteRule:
      "Nguyên tắc vàng: bản sao trên cùng thiết bị không phải là bản sao lưu. Giữ bản sao ở ít nhất hai nơi — ví dụ đám mây (Google Drive, Dropbox, OneDrive) và USB, hoặc tự gửi tệp qua email.",
  },
  zh: {
    app_bmfKitOffDeviceWarning:
      "重要：请勿仅将文件保存在此设备上。请将其复制到第二个位置 — 云存储（Google Drive、Dropbox）、U 盘，或通过电子邮件发送给自己。设备损坏时，其中的副本也会丢失。",
    app_vault_offsite_note:
      "建议：至少在此设备之外保留一份备份副本（云端、U 盘或电子邮件）。你的保险库仅存在于这个浏览器中。",
    backup_offsiteRule:
      "黄金法则：同一设备上的副本不算备份。请至少在两个地方保存副本 — 例如云端（Google Drive、Dropbox、OneDrive）和 U 盘，或将文件通过电子邮件发送给自己。",
  },
};

const KEYS = Object.keys(T.de); // canonical key order

let touched = 0;
for (const file of readdirSync(LOCALES_DIR).filter((f) => f.endsWith(".json")).sort()) {
  const code = file.replace(".json", "");
  if (code === "en" || code === "es") {continue;} // already shipped
  const translations = T[code];
  if (!translations) {
    console.warn(`[add-offsite] SKIP ${code}: no translations defined`);
    continue;
  }
  const path = join(LOCALES_DIR, file);
  const json = JSON.parse(readFileSync(path, "utf8"));
  const missing = KEYS.filter((k) => !(k in json));
  if (missing.length === 0) {continue;}
  // Insert preserving alphabetical order at roughly the right neighbours,
  // matching how the rest of the file is keyed. Simpler: add and re-sort
  // is NOT safe (existing file order is hand-curated), so insert each key
  // right before the first existing key that sorts after it alphabetically.
  const entries = Object.entries(json);
  for (const key of missing) {
    let insertAt = entries.length;
    for (let i = 0; i < entries.length; i++) {
      if (entries[i][0] > key) { insertAt = i; break; }
    }
    entries.splice(insertAt, 0, [key, translations[key]]);
  }
  writeFileSync(path, JSON.stringify(Object.fromEntries(entries), null, 2) + "\n");
  touched++;
  console.log(`[add-offsite] ${code}: +${missing.length} key(s)`);
}
console.log(`[add-offsite] done — ${touched} locale file(s) updated`);
