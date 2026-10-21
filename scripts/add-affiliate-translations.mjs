#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const T = JSON.parse(readFileSync(resolve(__dirname, "landing-translations.json"), "utf8"));

/**
 * The locale blocks below are the PUBLISHED landing copy this script injects
 * into scripts/landing-translations.json — data, not repository prose, which
 * is why that JSON is excluded from the Spanish-prose ratchet by path.
 * Each non-English line carries the `i18n-allow` pragma
 * scripts/check-no-spanish.mjs documents for exactly this case, so the
 * ratchet keeps policing authored prose without demanding a translation of
 * the Spanish/Portuguese copy the ES/PT landings are built from.
 */
const affiliateTranslations = {
  ar: {
    title: 'مرحباً بك في برنامج إحالات BookmarkForge',
    about: 'حول مستود معرفتك الذكائية بالتشفير من طرف إلى طرف',
    commission: 'ستكسب عمولة 30% متكررة على كل مستخدم يسجل عبر رابطك',
    holding: 'تدفع الأرباح تلقائياً إلى رصيدك بعد 30 يوم من شراء المستخدم',
    rules: 'قواعد مهمة (ممنوعة بصرامة):',
    rule1: 'الشراء الذاتي: لا يُسمح بشراء المنتج باستخدام رابطك الخاص للحصول على خصم',
    rule2: 'الإرسال العشوائي: إرسال رابطك في مجتمعات أخرى أو منتديات محظور تماماً',
    rule3: 'الإعلانات المضللة: لا تستخدم وعود زائفة أو معلومات قديمة لتحقيق البيع',
    tip: 'نصيحة مبيعات: شارك لقطات الشاشات، حالات استخدام حقيقية أو فيديوهات قصيرة تُظهر كيف يعمل BookmarkForge على وسائل التواصل الاجتماعي. العروضات الأصيلة تحول مرتين أفضل!'
  },
  bg: {
    title: 'Добре дошли в BookmarkForge Affiliate Program',
    about: 'Частен-first AI knowledge vault с end-to-end encryption',
    commission: 'Ще печелите 30% реcurring комисион за всеки потребител, регистриран чрез вашият линк',
    holding: 'Плащания се освобождават автоматично 30 дни след покупката',
    rules: 'Важни правила (строго забранени):',
    rule1: 'Самокупуване: Не се разрешава да купувате продукта с вашият affiliate link за отстъпка',
    rule2: 'Спам: Спам на линка в други общности или масови съобщения е напълно забранен',
    rule3: 'Въведливащи реклами: Не използвайте фалшиви обещания или остаряла информация',
    tip: 'Съвет за продажби: Споделете скрийншоти, реални случаи или кратки видеа показващи как работи BookmarkForge. Искрените демонстрации конвертират два пъти по-добре!'
  },
  cs: {
    title: 'Vítej v BookmarkForge Affiliate Program',
    about: 'Local-first AI knowledge vault s end-to-end encryption',
    commission: 'Získáte 30% recurring provizi za každého uživatele registrovaného přes váš odkaz',
    holding: 'Platby se automaticky uvolňují 30 dní po nákupu uživatele',
    rules: 'Důležitá pravidla (přísně zakázána):',
    rule1: 'Nákup vlastním odkazem: Není povoleno nakupovat produkt přes vlastní affiliate link pro slevu',
    rule2: 'Spam: Spamování odkazu v jiných komunitách je zcela zakázáno',
    rule3: 'Klamavá reklama: Nepoužívejte falešná sliby nebo zastaralé informace',
    tip: 'Tip prodeje: Sdílejte screenshoty, reálné případy nebo krátká videa ukazující, jak BookmarkForge funguje. Autentické demonstrace konvertují dvakrát lépe!'
  },
  da: {
    title: 'Velkommen til BookmarkForge Affiliate Program',
    about: 'Local-first AI knowledge vault med end-to-end encryption',
    commission: 'Du tjener 30% recurring kommission for hver bruger der registrerer via dit link',
    holding: 'Udbetalinger frigøres automatisk 30 dage efter brugerens køb',
    rules: 'Vigtige regler (strengt forbudt):',
    rule1: 'Eget køb med eget link: Du må ikke købe produktet med dit eget affiliate link for at få rabat',
    rule2: 'Spam: Spamming af dit link i andre fællesskaber er helt forbudt',
    rule3: 'Vildledende annoncer: Brug ikke falske løfter eller forældet information',
    tip: 'Salgstip: Del screenshots, reelle use cases eller korte videoer der viser, hvordan BookmarkForge fungerer. Autentiske demonstrationer konverterer to gange så godt!'
  },
  de: {
    title: 'Willkommen im BookmarkForge Affiliate Program',
    about: 'Local-first AI Knowledge Vault mit End-to-End-Verschlüsselung',
    commission: 'Sie erhalten 30% wiederkehrende Provision für jeden Nutzer, der sich über Ihren Link registriert',
    holding: 'Auszahlungen werden automatisch 30 Tage nach dem Kauf des Nutzers freigegeben',
    rules: 'Wichtige Regeln (streng verboten):',
    rule1: 'Eigener Kauf: Es ist nicht erlaubt, das Produkt über Ihren eigenen Affiliate-Link zu kaufen, um einen Rabatt zu erhalten',
    rule2: 'Spam: Spamming Ihres Links in anderen Communities ist völlig verboten',
    rule3: 'Irreführende Werbung: Verwenden Sie keine falschen Versprechen oder veraltete Informationen',
    tip: 'Verkaufstipp: Teilen Sie Screenshots, echte Anwendungsfälle oder kurze Videos, die zeigen, wie BookmarkForge funktioniert. Echte Demonstrationen konvertieren doppelt so gut!'
  },
  el: {
    title: 'Καλώς ήρθα στο BookmarkForge Affiliate Program',
    about: 'Local-first AI Knowledge Vault με end-to-end encryption',
    commission: 'Θα κερδίσετε 30% επαναλαμβανόμενη προμήση για κάθε χρήστη που εγγράφεται μέσω του link σας',
    holding: 'Οι πληρωμές απελευθερώνονται αυτόματα 30 ημέρες μετά την αγορά του χρήστη',
    rules: 'Σημαντικοί κανόνες (αυστηρά απαγορευμένα):',
    rule1: 'Αυτο-αγορά: Δεν επιτρέπεται να αγοράσετε το προϊόν με το δικό σας affiliate link για έκπτωση',
    rule2: 'Spam: Η αποστολή του link σας σε άλλες κοινότητες είναι εντελώς απαγορευμένη',
    rule3: 'Παραπλανητικές διαφημίσεις: Μην χρησιμοποιείτε ψευδείς υποσχέσεις ή ξεπερασμένες πληροφορίες',
    tip: 'Συμβουλή πωλήσεων: Μοιραστείτε στιγμιότυπα, πραγματικές περιπτώσεις ή σύντο βίντεο που δείχνουν πώς λειτουργεί το BookmarkForge. Οι αυθεντικές επιδείξεις έχουν διπλάσια μετατροπή!'
  },
  es: {
    title: 'Bienvenido al Programa de Afiliados de BookmarkForge',
    about: 'Bóveda de Conocimiento IA Local-First con Cifrado de Extremo a Extremo', // i18n-allow: published ES landing copy
    commission: 'Ganarás 30% de comisión recurrente por cada usuario que se registre a través de tu enlace', // i18n-allow: published ES landing copy
    holding: 'Los pagos se liberan automáticamente a tu saldo 30 días después de la compra del usuario', // i18n-allow: published ES landing copy
    rules: 'Reglas importantes (estrictamente prohibidas):',
    rule1: 'Autocompra: No se permite comprar el producto usando tu propio enlace de afiliado para obtener descuento', // i18n-allow: published ES landing copy
    rule2: 'Spam: Enviar spam de tu enlace en otras comunidades o foros está totalmente prohibido', // i18n-allow: published ES landing copy
    rule3: 'Anuncios engañosos: No uses promesas falsas o información desactualizada para asegurar la venta', // i18n-allow: published ES landing copy
    tip: 'Consejo de ventas: Comparte capturas de pantalla, casos de uso reales o videos cortos mostrando cómo funciona BookmarkForge en redes sociales (X/Twitter, TikTok, LinkedIn). Las demostraciones auténticas convierten el doble!' // i18n-allow: published ES landing copy
  },
  fi: {
    title: 'Tervetuloos BookmarkForge Affiliate Program',
    about: 'Local-first AI Knowledge Vault end-to-end encryptionilla',
    commission: 'Ansait 30% toistuvaa provisiota jokaisen käyttäjän rekisteröityessä linkisi kautta',
    holding: 'Maksut vapautetaan automaattisesti saldollesiin 30 päivää käyttäjän oston jälkeen',
    rules: 'Tärkeät säännöt (tiukasti kielletyt):',
    rule1: 'Oma ostaminen: Et saa ostaa tuotetta käyttämällä omaa affiliate-linkkiä alennusta',
    rule2: 'Spam: Linkin spämmääminen muissa yhteisöissä tai foorumeilla on kokonaan kielletty',
    rule3: 'Harhaannelliset mainokset: Älä käytä vääriä lupauksia tai vanhentunutta tietoa',
    tip: 'Myyntivinkki: Jaka kuvakaappauksia, todellisia käyttötapauksia tai lyhyitä videoita, jotka näyttävät miten BookmarkForge toimii. Aitoiset demoaatiot konvertoivat kaksi kertaa paremmin!'
  },
  fr: {
    title: 'Bienvenue dans le Programme d\'Affiliation BookmarkForge',
    about: 'Coffre de Connaissance IA Local-First avec Chiffrement de Bout en Bout',
    commission: 'Vous gagnez 30% de commission récurrente pour chaque utilisateur qui s\'inscrit via votre lien',
    holding: 'Les paiements sont libérés automatiquement dans votre solde 30 jours après l\'achat de l\'utilisateur',
    rules: 'Règles importantes (strictement interdites):',
    rule1: 'Auto-achat: Il n\'est pas autorisé d\'acheter le produit avec votre propre lien d\'affiliation pour obtenir une remise',
    rule2: 'Spam: L\'envoi de spam de votre lien dans d\'autres communautés est totalement interdit',
    rule3: 'Publicités trompeuses: N\'utilisez pas de fausses promesses ou d\'informations obsolètes pour sécuriser une vente',
    tip: 'Conseil de vente: Partagez des captures d\'écran, des cas d\'utilisation réels ou des vidéos courtes montrant comment BookmarkForge fonctionne. Les démonstrations authentiques convertissent deux fois mieux!'
  },
  he: {
    title: 'ברוכים אל תוכנית השותפים של BookmarkForge',
    about: 'כס אמון IA Local-First עם הצפנה End-to-End',
    commission: 'תרוויח 30% עמלה חוזרת על כל משתמש שנרשם דרך הקישור שלך',
    holding: 'התשלומים משוחררים אוטומטית לסלונך שלך 30 ימים לאחר רכישת המשתמש',
    rules: 'כללים חשובים (אסור אסור מוחלט):',
    rule1: 'רכישה עצמית: אסור לךכור את המוצר באמצעות הקישור השותפי שלך לקבלת הנחה',
    rule2: 'ספאם: שליחת ספאם של הקישור בקהילות אחרות או מסרים המונים אסור לחלוטין',
    rule3: 'פרסומות מטעות: אל תשתמש הבטחות כוזבות או מידע ישנה להשיג מכירה',
    tip: 'טיפ למכירה: שתף צילומי מסך, מקרים שימוש אמיתיים או סרטונים קצרים המראים איך BookmarkForge עובד. הדגמות האותנטיות ממירים החדש!'
  },
  hi: {
    title: 'BookmarkForge Affiliate Program में आपका स्वागत है',
    about: 'Local-first AI Knowledge Vault with End-to-End Encryption',
    commission: 'आप हर उपयोगकी के लिंक से माध्यम से रजिस्टर होने पर 30% recurring कमीशन कमाएंगे',
    holding: 'भुगतान 30 दिनों के बाद उपयोगकी के बाद आपके बैलेंस में स्वचालित रूप से जारी होती है',
    rules: 'महत्वपूर्ण नियम (सखत में प्रतिबंदित):',
    rule1: 'स्वयं खरीदारी: अपने एफिलिएट लिंक का उपयोग करने के लिए अपने लिंक का उपयोग करने की अनुमति नहीं है',
    rule2: 'स्पैम: अन्य समुदायों या फोरम में अपने लिंक का स्पैम करना पूरी तरह प्रतिबंदित है',
    rule3: 'भ्राम विज्ञापन: बिक्री को सुरक्षित करने के लिए झूठे वादे या पुराना जानकारी मत करें',
    tip: 'बिक्री टिप: स्क्रीनशॉट्स, वास्तविक मामले या छोटे वीडियो शेयर करें जो दिखाता है कि BookmarkForge कैसे काम करता है। प्रामाणिक प्रदर्शन दोगुना बेहतरी है!'
  },
  hr: {
    title: 'Dobrodošli u BookmarkForge Affiliate Program',
    about: 'Local-first AI knowledge vault s end-to-end encryption',
    commission: 'Zaradit ćete 30% recurring proviziju za svakog korisnika koji se registrira putem vašeg linka',
    holding: 'Isplate se automatski oslobađaju na vaš saldo 30 dana nakon kupnje korisnika',
    rules: 'Važna pravila (strogo zabranjena):',
    rule1: 'Samokupnina: Nije dopušteno kupiti proizvod vlastitim affiliate linkom za popust',
    rule2: 'Spam: Slanje vašeg linka u druge zajednice je potpuno zabranjeno',
    rule3: 'Lažne reklame: Nemojte koristiti lažna obećanja ili zastarjele informacije',
    tip: 'Prodajni savjet: Dijelite snimke, stvarne slučaje ili kratke videe prikazujujući kako BookmarkForge radi. Istinske demonstracije konvertiraju dvostruko bolje!'
  },
  hu: {
    title: 'Üdvözöl a BookmarkForge Affiliate Program',
    about: 'Local-first AI knowledge vault end-to-end titkoítással',
    commission: '30% ismétlő jutalékot kapsz minden felhasználónál, aki a te linked keresztül regisztrál',
    holding: 'Kifizetések automatikusan 30 nappal a felhasználó vásárlása után a számládra',
    rules: 'Fontos szabályok (szigorúan tiltott):',
    rule1: 'Saját vásárlás: Nem engedélyezett a termék saját affiliate linkkel vásárolni kedvezményért',
    rule2: 'Spam: A link küldése más közösségekben vagy fórumokon teljesen tiltott',
    rule3: 'Téves hirdetések: Ne használjon hamis ígéreteket vagy elavult információt',
    tip: 'Értékesítési tipp: Oszd meg képernyőképeket, valós felhasználási eseteket vagy rövid videókat, amelyek bemutatják, hogyan működik a BookmarkForge. A hiteles bemutatások kétszer jobban konvertálnak!'
  },
  id: {
    title: 'Selamat Datang di BookmarkForge Affiliate Program',
    about: 'Local-first AI Knowledge Vault dengan End-to-End Encryption',
    commission: 'Andapatkan 30% komisi berulang untuk setiap pengguna yang mendaftar melalui link Anda',
    holding: 'Pembayaran otomatis dilepaskan ke saldo Anda 30 hari setelah pembelian pengguna',
    rules: 'Peraturan penting (dilarang ketat):',
    rule1: 'Pembelian sendiri: Tidak diizinkan membeli produk menggunakan link affiliate Anda sendiri untuk mendapatkan diskon',
    rule2: 'Spam: Mengirim spam link Anda di komunitas lain atau forum dilarang total',
    rule3: 'Iklan menipulatif: Jangan gunakan janji palsu atau informasi ketinggalan untuk mendapatkan penjualan',
    tip: 'Tip penjualan: Bagikan screenshot, use case nyata atau video pendek yang menunjukkan cara kerja BookmarkForge. Demonstrasi autentik berkonversi dua kali lebih baik!'
  },
  it: {
    title: 'Benvenuto nel Programma di Affiliazione BookmarkForge',
    about: 'Local-first AI Knowledge Vault con cifratura end-to-end',
    commission: 'Guadagnerai il 30% di commissione ricorrente per ogni utente che si registra tramite il tuo link',
    holding: 'I pagamenti vengono rilasciati automaticamente sul tuo saldo 30 giorni dopo l\'acquisto dell\'utente',
    rules: 'Regole importanti (vietate severamente):',
    rule1: 'Auto-acquisto: Non è permesso acquistare il prodotto usando il tuo link di affiliazione per ottenere uno sconto',
    rule2: 'Spam: Inviare spam del tuo link in altre community o forum è vietato',
    rule3: 'Pubblicità ingannevoli: Non usare promesse false o informazioni obsolete per assicurare la vendita',
    tip: 'Consiglio vendite: Condividi screenshot, casi d\'uso reali o video brevi che mostrano come funziona BookmarkForge. Le dimostrazioni autentiche convertono due volte meglio!'
  },
  ja: {
    title: 'BookmarkForgeアフィリエイトプログラムへようこそ',
    about: 'Local-first AI Knowledge Vault（エンドツーエード暗号化）',
    commission: 'リンク経由で登録されるユーザーごとに30%の継続コミッションを獲得',
    holding: 'ユーザーの購入から30日後に自動的に残高に解放',
    rules: '重要なルール（厳格に禁止）:',
    rule1: '自己購入: 自分のアフィリエイトリンクで製品を購入して割引を受けることは禁止されています',
    rule2: 'スパム: 他のコミュニティやフォーラムでリンクをスパムすることは完全に禁止されています',
    rule3: '誤った広告: 販を確保するために偽の約束や古い情報を使用しないでください',
    tip: '販売のヒント: スクリーンショット、実際の使用例、またはBookmarkForgeがどのように機能するかを示す短いビデオをソーシャルメディア（X/Twitter、TikTok、LinkedIn）で共有してください。本物のデモは2倍の効果があります！'
  },
  ko: {
    title: 'BookmarkForge 제휴 프로그램에 오신 것을 환영합니다',
    about: '로컬 퍼스트 AI 지식 보물소 엔드 투 엔드 암호화',
    commission: '링크를 통해 등록하는 모든 사용자에 대해 30% 계속 수수료를 획득',
    holding: '사용자 구매 후 30일에 자동으로 잔액으로 해제',
    rules: '중요한 규칙 (엄격히 금지):',
    rule1: '자가 구매: 자신의 제휴 링크로 제품을 구매하여 할인을 받는 것은 금지됩니다',
    rule2: '스팸: 다른 커뮤니티나 포럼에서 링크를 스팸하는 것은 완전히 금지됩니다',
    rule3: '오해 광고: 판매를 확보하기 위해 거짓 약속이나 구식 정보를 사용하지 마세요',
    tip: '판매 팁: 스크린샷, 실제 사용 사례 또는 BookmarkForge가 어떻게 작동하는지 보여주는 짧은 비디오를 소셜 미디어(X/Twitter, TikTok, LinkedIn)에 공유하세요. 진짜 데모는 두 배 더 잘 전환됩니다!'
  },
  nl: {
    title: 'Welkom bij het BookmarkForge Affiliate Program',
    about: 'Local-first AI Knowledge Vault met end-to-end encryptie',
    commission: 'Je verdient 30% doorlopende commissie voor elke gebruiker die zich via jouw link registreert',
    holding: 'Uitbetalingen worden automatisch vrijgegeven aan je saldo 30 dagen na de aankoop van de gebruiker',
    rules: 'Belangrijke regels (strikt verboden):',
    rule1: 'Zelfaankoop: Het is niet toegestaan om het product te kopen met je eigen affiliate link om korting te krijgen',
    rule2: 'Spam: Spamming van je link in andere communities is volledig verboden',
    rule3: 'Misleidende advertenties: Gebruik geen valse beloften of verouderde informatie',
    tip: 'Verkoepstip: Deel screenshots, echte use cases of korte video\'s die laten zien hoe BookmarkForge werkt. Authentieke demonstraties converteren twee keer zo goed!'
  },
  no: {
    title: 'Velkommen til BookmarkForge Affiliate Program',
    about: 'Local-first AI Knowledge Vault med end-to-end kryptering',
    commission: 'Du tjener 30% gjentak kommisjon for hver bruker som registrerer via din link',
    holding: 'Utbetalinger frigjøres automatisk 30 dager etter brukerens kjøp',
    rules: 'Viktige regler (strengt forbudt):',
    rule1: 'Eget kjøp: Du må ikke kjøpe produktet med ditt eget affiliate link for å få rabatt',
    rule2: 'Spam: Spamming av din link i andre fellesskaper er helt forbudt',
    rule3: 'Villedledende annonser: Bruk ikke falske løfter eller utdatert informasjon',
    tip: 'Salgstips: Del screenshots, reelle bruksomstilfeller eller korte videoer som viser hvordan BookmarkForge funger. Ekte demonstrasjoner konverterer to ganger så godt!'
  },
  pl: {
    title: 'Witamy w Programie Partnerskim BookmarkForge',
    about: 'Local-first AI Knowledge Vault z szyfrowaniem end-to-end',
    commission: 'Zarabiasz 30% prowizji cyklicznej za każdego użytkownika, który zarejestruje przez Twój link',
    holding: 'Wypłaty są automatycznie uwalniane na Twoje saldo 30 dni po zakupie użytkownika',
    rules: 'Ważne zasady (ściśle zabronione):',
    rule1: 'Sam zakup: Nie wolno kupować produktu za pomocą własnego linku partnerskiego, aby uzyskać zniżkę',
    rule2: 'Spam: Spamowanie linka w innych społecznościach lub na forach jest całkowicie zabronione',
    rule3: 'Mylące reklamy: Nie używaj fałszywych obietnic lub nieaktualnych informacji',
    tip: 'Wskazówka sprzedaży: Udostępnij zrzuty ekranowe, prawdziwe przypadki użycia lub krótkie filmy pokazujące, jak działa BookmarkForge. Autentyczne demonstracje konwertują dwa razy lepiej!'
  },
  pt: {
    title: 'Bem-vindo ao Programa de Afiliados BookmarkForge',
    about: 'Cofre de Conhecimento IA Local-First com Criptografia de Ponta a Ponta',
    commission: 'Ganhe 30% de comissão recorrente por cada usuário que se registre através do seu link', // i18n-allow: published PT landing copy
    holding: 'Os pagamentos são liberados automaticamente para seu saldo 30 dias após a compra do usuário', // i18n-allow: published PT landing copy
    rules: 'Regras importantes (estritamente proibidas):',
    rule1: 'Autocompra: Não é permitido comprar o produto usando seu próprio link de afiliado para obter desconto',
    rule2: 'Spam: Enviar spam do seu link em outras comunidades ou fóruns é totalmente proibido',
    rule3: 'Anúncios enganosos: Não use promessas falsas ou informações desatualizadas para garantir a venda',
    tip: 'Dica de vendas: Compartilhe capturas de tela, casos de uso reais ou vídeos curtos mostrando como o BookmarkForge funciona nas redes sociais (X/Twitter, TikTok, LinkedIn). Demonstrações autênticas convertem o dobro!' // i18n-allow: published PT landing copy
  },
  ro: {
    title: 'Binevenit la Programulul de Afiliere BookmarkForge',
    about: 'Local-first AI Knowledge Vault cu criptare end-to-end',
    commission: 'Veți câștiga 30% comision recurrentă pentru fiecare utilizator care se înregistrează prin link-ul dvs.',
    holding: 'Plățile sunt eliberate automat în soldul tău 30 de zile după achiziția utilizatorului',
    rules: 'Reguli importante (strict interzis):',
    rule1: 'Autocumpărare: Nu este permis să cumpărați produsul folosind propriul link de afiliat pentru a obține reducere',
    rule2: 'Spam: Trimiterea linkului dvs în alte comunități sau forumuri este complet interzis',
    rule3: 'Reclame înșelătoare: Nu folosi promisiuni false sau informații învechite pentru a asigura vânzarea',
    tip: 'Sfat de vânzare: Distribuiți capturi de ecran, cazuri de utilizare reale sau videoclipuri scurte care arată cum funcționează BookmarkForge. Demonstrările autentice convertesc de două ori mai bine!'
  },
  ru: {
    title: 'Добро пожаловать в программу партнерских рекомендаций BookmarkForge',
    about: 'Local-first AI Knowledge Vault с шифрованием end-to-end',
    commission: 'Вы зарабатываете 30% рекуррентной комиссии за каждого пользователя, который регистрируется через вашу ссылку',
    holding: 'Выплаты автоматически освобождаются на ваш баланс через 30 дней после покупки пользователя',
    rules: 'Важные правила (строго запрещено):',
    rule1: 'Самокупка: Не разрешается покупать продукт через собственную партнерскую ссылку для получения скидки',
    rule2: 'Спам: Рассылка вашей ссылки в других сообществах или форумах полностью запрещена',
    rule3: 'Вводящая реклама: Не используйте ложные обещания или устаревшую информацию',
    tip: 'Совет по продажам: Делитесь скриншотами, реальными случаями использования или короткими видео, показывающими, как работает BookmarkForge. Аутентичные демонстрации конвертируют в два раза лучше!'
  },
  sv: {
    title: 'Välkommen till BookmarkForge Affiliate Program',
    about: 'Local-first AI Knowledge Vault med end-to-end kryptering',
    commission: 'Du tjänar 30% återkommande provision för varje användare som registrerar via din länk',
    holding: 'Utbetalningar frigörs automatiskt till ditt saldo 30 dagar efter användarens köp',
    rules: 'Viktiga regler (stängt förbjudet):',
    rule1: 'Självköp: Det är inte tillåtet att köpa produkten med din egen affiliate-länk för att få rabatt',
    rule2: 'Spam: Att skicka spam på din länk i andra communities är helt förbjudet',
    rule3: 'Vilseledande annonser: Använd inte falska löften eller föråldrad information',
    tip: 'Säljtips: Dela skärmdumpar, riktiga användningsfall eller korta videor som visar hur BookmarkForge fungerar. Autentiska demonstrationer konverterar dubbelt så bra!'
  },
  th: {
    title: 'ยินดีต้อนสู่โปรแกรมพันธม์ค์ BookmarkForge',
    about: 'Local-first AI Knowledge Vault พร้อมการเข้ารหัส end-to-end',
    commission: 'คุณจะได้รับ 30% ค่าคอมมิชชั่นทุกผู้ใช้ที่ลงทะเบียนผ่านลิงก์ของคุณ',
    holding: 'การจ่ายเงินจะปล่อยอัตโนมาเป็นยอดอนี้หลังการซื้อจำนวนของผู้ใช้ 30 วัน',
    rules: 'กฎสำคัญที่สำคัญ (ห้ามอย่างเข้มง):',
    rule1: 'การซื้อเอง: ไม่อนุญาให้ซื้อสินผลิตภายใช้ลิงก์พันธม์ของคุณเพื่อรับส่วน',
    rule2: 'สแปม: การส่งสแปมของคุณในชุมชุดอื่นหรือฟอรัมเป็นสิ้นเข้มง',
    rule3: 'โฆษณการติดตา: อย่าใช้คำสัญงหรือข้อมูลเก่าเพื่อรับการขายขาย',
    tip: 'เคล็ิปขาย: แช่สแตริปรักษ์ กรณีภาพสิ่ง หรือคํชการใช้งานจริงที่แสดงว่า BookmarkForge ทำงงานอย่างไรบ การแสดงที่แท้จริ้แปลงสองครั้งที่ดีมากกขึ้น!'
  },
  tr: {
    title: 'BookmarkForge Satış Ortaklığı Programına Hoş Geldiniz',
    about: 'Local-first AI Knowledge Vault uçtan uca şifreleme',
    commission: 'Linkiniz üzerinden kaydolan her kullanıcı için %30 yinelen komisyon kazanırsınız',
    holding: 'Ödemeler kullanıcının satın almasından 30 gün sonra otomatik olarak bakiyenize serbest bırılır',
    rules: 'Önemli kurallar (kesinlikle yasak):',
    rule1: 'Kendi satın alma: Kendi affiliate linkinizi kullanarak ürün satın almak indirim için yasaktır',
    rule2: 'Spam: Linkinizi diğer topluluklarda veya forumlarda spam göndermek tamamen yasaktır',
    rule3: 'Yanlış reklamlar: Satışı sağlamak için yanlış vaatler veya eski bilgiler kullanmayın',
    tip: 'Satış ipucu: Ekran görüntüleri, gerçek kullanım durumlarını veya BookmarkForge\'in nasıl çalıştığını gösteren kısa videoları sosyal medyada (X/Twitter, TikTok, LinkedIn) paylaşın. Otantik gösterimler iki kat daha iyi dönüşür!'
  },
  uk: {
    title: 'Ласкаво до партнерської програми BookmarkForge',
    about: 'Local-first AI Knowledge Vault з end-to-end шифруванням',
    commission: 'Ви отримаєте 30% повторюваної комісії за кожного користувача, який реєструється через ваше посилання',
    holding: 'Виплати автоматично звільняються на ваш баланс через 30 днів після покупки користувача',
    rules: 'Важливі правила (суворо заборонено):',
    rule1: 'Самопридбання: Не дозволяється купувати продукт через власне партнерське посилання для отримання знижки',
    rule2: 'Спам: Розсилання вашого посилання в інших спільнотах або на форумах повністю заборонено',
    rule3: 'Введливна реклама: Не використовуйте хибні обіцянки або застарілу інформацію',
    tip: 'Порада з продажу: Діліться скріншотами, реальними випадками використання або короткими відео, які показують, як працює BookmarkForge. Справжні демонстрації конвертують вдвічі краще!'
  },
  vi: {
    title: 'Chào mừng đến Chương trình Tiếp thị BookmarkForge',
    about: 'Local-first AI Knowledge Vault với mã hóa end-to-end',
    commission: 'Bạn sẽ nhận được 30% hoa hồng định kỳ cho mỗi người dùng đăng ký qua liên kết của bạn',
    holding: 'Thanh toán sẽ được tự động giải phóng vào số dư của bạn 30 ngày sau khi người dùng mua',
    rules: 'Quy tắc quan trọng (nghiêm cấm):',
    rule1: 'Tự mua: Không được mua sản phẩm bằng liên kết tiếp thị của bạn để nhận giảm giá',
    rule2: 'Spam: Gửi spam liên kết của bạn trong các cộng đồng khác hoặc diễn đàn hoàn toàn bị cấm',
    rule3: 'Quảng cáo sai lệ: Không sử dụng lời hứa hão hão hoặc thông tin lỗi thời để đảm bảo bán hàng',
    tip: 'Mẹo bán hàng: Chia sẻ ảnh chụp màn hình, trường hợp sử dụng thực tế hoặc video ngắn cho thấy cách BookmarkForge hoạt động. Bản demo chân thực chuyển đổi gấp đôi!'
  },
  zh: {
    title: '欢迎加入 BookmarkForge 联盟计划',
    about: '本地优先AI知识库，端到端加密',
    commission: '通过您的链接注册的每个用户，您将获得30%循环佣金',
    holding: '付款30天后自动释放到您的余额',
    rules: '重要规则（严格禁止）：',
    rule1: '自购：不允许使用自己的联盟链接购买产品以获得折扣',
    rule2: '垃圾信息：在其他社区或论坛中发送垃圾信息是完全禁止的',
    rule3: '误导性广告：不得使用虚假承诺或过时信息来保证销售',
    tip: '销售技巧：分享截图、真实用例或短视频，在社交媒体（X/Twitter、TikTok、LinkedIn）上展示BookmarkForge如何工作。真实的演示效果翻倍！'
  }
};

Object.keys(T).forEach(lang => {
  if (affiliateTranslations[lang]) {
    T[lang].affiliateTitle = affiliateTranslations[lang].title;
    T[lang].affiliateAbout = affiliateTranslations[lang].about;
    T[lang].affiliateCommission = affiliateTranslations[lang].commission;
    T[lang].affiliateHolding = affiliateTranslations[lang].holding;
    T[lang].affiliateRules = affiliateTranslations[lang].rules;
    T[lang].affiliateRule1 = affiliateTranslations[lang].rule1;
    T[lang].affiliateRule2 = affiliateTranslations[lang].rule2;
    T[lang].affiliateRule3 = affiliateTranslations[lang].rule3;
    T[lang].affiliateTip = affiliateTranslations[lang].tip;
  }
});

writeFileSync(resolve(__dirname, "landing-translations.json"), JSON.stringify(T, null, 2));
console.log('Added affiliate program translations to all languages');
