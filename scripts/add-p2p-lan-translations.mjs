/**
 * add-p2p-lan-translations.mjs
 * Adds the 3 P2P same-LAN requirement keys to every locale missing them.
 * Keys are inserted right after "app_p2pUnsupported" so the P2P translation
 * block stays contiguous in every locale file. Idempotent: skips locales
 * that already have all 3 keys.
 * Usage: node scripts/add-p2p-lan-translations.mjs
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const LOCALES_DIR = "public/locales";

/** Translations for the 3 new keys, keyed by locale code. */
const T = {
  en: {
    app_p2pLanWarningTitle:
      "Both devices must be on the same Wi-Fi network",
    app_p2pLanWarningBody:
      "This sync works device-to-device over your local network, never through the internet. If the devices are on different networks (for example, one on mobile data), pairing and syncing will fail.",
    app_p2pLanWarningHint:
      "Tip: turn off mobile data on your phone and connect it to the same Wi-Fi as your computer.",
  },
  es: {
    app_p2pLanWarningTitle:
      "Ambos dispositivos deben estar en la misma red Wi-Fi",
    app_p2pLanWarningBody:
      "Esta sincronización funciona de dispositivo a dispositivo a través de tu red local, nunca a través de internet. Si los dispositivos están en redes distintas (por ejemplo, uno con datos móviles), el emparejamiento y la sincronización fallarán.",
    app_p2pLanWarningHint:
      "Consejo: desactiva los datos móviles del teléfono y conéctalo al mismo Wi-Fi que tu ordenador.",
  },
  ar: {
    app_p2pLanWarningTitle:
      "يجب أن يكون كلا الجهازين على شبكة Wi-Fi نفسها",
    app_p2pLanWarningBody:
      "تعمل هذه المزامنة من جهاز إلى جهاز عبر شبكتك المحلية، وليست عبر الإنترنت أبدًا. إذا كان الجهازان على شبكات مختلفة (مثلًا أحدهما على بيانات الجوال)، فسيفشل الاقتران والمزامنة.",
    app_p2pLanWarningHint:
      "نصيحة: أوقف بيانات الجوال على هاتفك ووصّله بشبكة Wi-Fi نفسها التي يستخدمها حاسوبك.",
  },
  bg: {
    app_p2pLanWarningTitle:
      "Двете устройства трябва да са в една и съща Wi-Fi мрежа",
    app_p2pLanWarningBody:
      "Тази синхронизация работи от устройство на устройство чрез вашата локална мрежа, никога през интернет. Ако устройствата са в различни мрежи (например едното на мобилни данни), сдвояването и синхронизацията ще се провалят.",
    app_p2pLanWarningHint:
      "Съвет: изключете мобилните данни на телефона си и го свържете към същата Wi-Fi мрежа като компютъра.",
  },
  cs: {
    app_p2pLanWarningTitle:
      "Obě zařízení musí být ve stejné síti Wi-Fi",
    app_p2pLanWarningBody:
      "Tato synchronizace funguje mezi zařízeními přes vaši místní síť, nikdy přes internet. Pokud jsou zařízení v různých sítích (například jedno na mobilních datech), spárování i synchronizace selžou.",
    app_p2pLanWarningHint:
      "Tip: vypněte mobilní data v telefonu a připojte jej ke stejné síti Wi-Fi jako počítač.",
  },
  da: {
    app_p2pLanWarningTitle:
      "Begge enheder skal være på samme Wi-Fi-netværk",
    app_p2pLanWarningBody:
      "Denne synkronisering fungerer fra enhed til enhed via dit lokale netværk, aldrig via internettet. Hvis enhederne er på forskellige netværk (for eksempel én på mobildata), mislykkes parring og synkronisering.",
    app_p2pLanWarningHint:
      "Tip: sluk for mobildata på telefonen, og forbind den til samme Wi-Fi som computeren.",
  },
  de: {
    app_p2pLanWarningTitle:
      "Beide Geräte müssen sich im selben WLAN befinden",
    app_p2pLanWarningBody:
      "Diese Synchronisierung funktioniert direkt zwischen den Geräten über Ihr lokales Netzwerk, nie über das Internet. Befinden sich die Geräte in verschiedenen Netzwerken (z. B. eines über mobile Daten), schlagen Kopplung und Synchronisierung fehl.",
    app_p2pLanWarningHint:
      "Tipp: Deaktivieren Sie die mobilen Daten Ihres Telefons und verbinden Sie es mit demselben WLAN wie Ihren Computer.",
  },
  el: {
    app_p2pLanWarningTitle:
      "Και οι δύο συσκευές πρέπει να βρίσκονται στο ίδιο δίκτυο Wi-Fi",
    app_p2pLanWarningBody:
      "Αυτός ο συγχρονισμός λειτουργεί από συσκευή σε συσκευή μέσω του τοπικού σας δικτύου, ποτέ μέσω διαδικτύου. Αν οι συσκευές βρίσκονται σε διαφορετικά δίκτυα (π.χ. η μία σε δεδομένα κινητού), η σύζευξη και ο συγχρονισμός θα αποτύχουν.",
    app_p2pLanWarningHint:
      "Συμβουλή: απενεργοποιήστε τα δεδομένα κινητού στο τηλέφωνό σας και συνδέστε το στο ίδιο Wi-Fi με τον υπολογιστή σας.",
  },
  fi: {
    app_p2pLanWarningTitle:
      "Molemmat laitteet on yhdistettävä samaan Wi-Fi-verkkoon",
    app_p2pLanWarningBody:
      "Tämä synkronointi toimii laitteelta laitteelle paikallisen verkkosi kautta, ei koskaan internetin kautta. Jos laitteet ovat eri verkoissa (esimerkiksi toinen mobiilidatalla), laiteparin muodostaminen ja synkronointi epäonnistuvat.",
    app_p2pLanWarningHint:
      "Vinkki: poista puhelimen mobiilidat käytöstä ja yhdistä se samaan Wi-Fi-verkkoon kuin tietokone.",
  },
  fr: {
    app_p2pLanWarningTitle:
      "Les deux appareils doivent être sur le même réseau Wi-Fi",
    app_p2pLanWarningBody:
      "Cette synchronisation fonctionne d'appareil à appareil via votre réseau local, jamais via Internet. Si les appareils sont sur des réseaux différents (par exemple l'un en données mobiles), l'appairage et la synchronisation échoueront.",
    app_p2pLanWarningHint:
      "Astuce : désactivez les données mobiles de votre téléphone et connectez-le au même Wi-Fi que votre ordinateur.",
  },
  he: {
    app_p2pLanWarningTitle:
      "שני המכשירים חייבים להיות באותה רשת Wi-Fi",
    app_p2pLanWarningBody:
      "סנכרון זה פועל ממכשיר למכשיר דרך הרשת המקומית שלכם, לעולם לא דרך האינטרנט. אם המכשירים נמצאים ברשתות שונות (למשל אחד באמצעות נתונים סלולריים), ההתאמה והסנכרון ייכשלו.",
    app_p2pLanWarningHint:
      "טיפ: כבו את הנתונים הסלולריים בטלפון וחברו אותו לאותו Wi-Fi כמו המחשב.",
  },
  hi: {
    app_p2pLanWarningTitle:
      "दोनों डिवाइस एक ही Wi-Fi नेटवर्क पर होने चाहिए",
    app_p2pLanWarningBody:
      "यह सिंक आपके स्थानीय नेटवर्क के ज़रिए डिवाइस-से-डिवाइस काम करता है, कभी भी इंटरनेट के ज़रिए नहीं। यदि डिवाइस अलग-अलग नेटवर्क पर हैं (उदाहरण के लिए, एक मोबाइल डेटा पर), तो पेयरिंग और सिंक विफल हो जाएगा।",
    app_p2pLanWarningHint:
      "सुझाव: फ़ोन का मोबाइल डेटा बंद करें और उसे कंप्यूटर जैसे ही Wi-Fi से कनेक्ट करें।",
  },
  hr: {
    app_p2pLanWarningTitle:
      "Oba uređaja moraju biti na istoj Wi-Fi mreži",
    app_p2pLanWarningBody:
      "Ova sinkronizacija radi s uređaja na uređaj putem vaše lokalne mreže, nikad putem interneta. Ako su uređaji na različitim mrežama (na primjer jedan na mobilnim podacima), uparivanje i sinkronizacija će zakazati.",
    app_p2pLanWarningHint:
      "Savjet: isključite mobilne podatke na telefonu i povežite ga na isti Wi-Fi kao računalo.",
  },
  hu: {
    app_p2pLanWarningTitle:
      "Mindkét eszköznek ugyanazon a Wi-Fi hálózaton kell lennie",
    app_p2pLanWarningBody:
      "Ez a szinkronizálás eszközről eszközre működik a helyi hálózaton keresztül, soha nem az interneten keresztül. Ha az eszközök különböző hálózatokon vannak (például az egyik mobilhálózaton), a párosítás és a szinkronizálás sikertelen lesz.",
    app_p2pLanWarningHint:
      "Tipp: kapcsolja ki a telefon mobiladatait, és csatlakoztassa ugyanahhoz a Wi-Fi-hez, mint a számítógép.",
  },
  id: {
    app_p2pLanWarningTitle:
      "Kedua perangkat harus berada di jaringan Wi-Fi yang sama",
    app_p2pLanWarningBody:
      "Sinkronisasi ini bekerja antarperangkat melalui jaringan lokal Anda, tidak pernah melalui internet. Jika perangkat berada di jaringan yang berbeda (misalnya salah satu menggunakan data seluler), pemasangan dan sinkronisasi akan gagal.",
    app_p2pLanWarningHint:
      "Tips: matikan data seluler di ponsel Anda dan hubungkan ke Wi-Fi yang sama dengan komputer.",
  },
  it: {
    app_p2pLanWarningTitle:
      "Entrambi i dispositivi devono essere sulla stessa rete Wi-Fi",
    app_p2pLanWarningBody:
      "Questa sincronizzazione funziona da dispositivo a dispositivo attraverso la rete locale, mai attraverso Internet. Se i dispositivi sono su reti diverse (ad esempio uno su dati mobili), abbinamento e sincronizzazione falliranno.",
    app_p2pLanWarningHint:
      "Suggerimento: disattiva i dati mobili sul telefono e connettilo alla stessa rete Wi-Fi del computer.",
  },
  ja: {
    app_p2pLanWarningTitle:
      "両方のデバイスが同じ Wi-Fi ネットワークに接続されている必要があります",
    app_p2pLanWarningBody:
      "この同期はローカルネットワーク経由でデバイス間で直接行われ、インターネットは一切使用しません。デバイスが異なるネットワークにいる場合（例：片方だけモバイルデータ通信）、ペアリングと同期は失敗します。",
    app_p2pLanWarningHint:
      "ヒント：スマートフォンのモバイルデータをオフにして、パソコンと同じ Wi-Fi に接続してください。",
  },
  ko: {
    app_p2pLanWarningTitle:
      "두 기기가 모두 같은 Wi-Fi 네트워크에 연결되어 있어야 합니다",
    app_p2pLanWarningBody:
      "이 동기화는 로컬 네트워크를 통해 기기 간에 직접 이루어지며 인터넷은 절대 사용하지 않습니다. 기기가 서로 다른 네트워크에 있으면(예: 한 기기가 모바일 데이터 사용) 페어링과 동기화가 실패합니다.",
    app_p2pLanWarningHint:
      "팁: 휴대전화의 모바일 데이터를 끄고 컴퓨터와 같은 Wi-Fi에 연결하세요.",
  },
  nl: {
    app_p2pLanWarningTitle:
      "Beide apparaten moeten op hetzelfde wifi-netwerk zijn aangesloten",
    app_p2pLanWarningBody:
      "Deze synchronisatie werkt van apparaat naar apparaat via uw lokale netwerk, nooit via internet. Als de apparaten op verschillende netwerken zitten (bijvoorbeeld één op mobiele data), mislukt het koppelen en synchroniseren.",
    app_p2pLanWarningHint:
      "Tip: schakel mobiele data op uw telefoon uit en verbind deze met hetzelfde wifi-netwerk als uw computer.",
  },
  no: {
    app_p2pLanWarningTitle:
      "Begge enhetene må være på samme Wi-Fi-nettverk",
    app_p2pLanWarningBody:
      "Denne synkroniseringen fungerer fra enhet til enhet via det lokale nettverket ditt, aldri via internett. Hvis enhetene er på forskjellige nettverk (for eksempel én på mobildata), vil sammenkobling og synkronisering mislykkes.",
    app_p2pLanWarningHint:
      "Tips: slå av mobildata på telefonen og koble den til samme Wi-Fi som datamaskinen.",
  },
  pl: {
    app_p2pLanWarningTitle:
      "Oba urządzenia muszą być w tej samej sieci Wi-Fi",
    app_p2pLanWarningBody:
      "Ta synchronizacja działa między urządzeniami przez sieć lokalną, nigdy przez internet. Jeśli urządzenia są w różnych sieciach (na przykład jedno na danych komórkowych), parowanie i synchronizacja nie powiodą się.",
    app_p2pLanWarningHint:
      "Wskazówka: wyłącz dane komórkowe w telefonie i połącz go z tą samą siecią Wi-Fi co komputer.",
  },
  pt: {
    app_p2pLanWarningTitle:
      "Ambos os dispositivos devem estar na mesma rede Wi-Fi",
    app_p2pLanWarningBody:
      "Esta sincronização funciona de dispositivo para dispositivo através da sua rede local, nunca através da internet. Se os dispositivos estiverem em redes diferentes (por exemplo, um em dados móveis), o emparelhamento e a sincronização falharão.",
    app_p2pLanWarningHint:
      "Dica: desative os dados móveis do telemóvel e conecte-o ao mesmo Wi-Fi que o computador.",
  },
  ro: {
    app_p2pLanWarningTitle:
      "Ambele dispozitive trebuie să fie în aceeași rețea Wi-Fi",
    app_p2pLanWarningBody:
      "Această sincronizare funcționează de la dispozitiv la dispozitiv prin rețeaua dvs. locală, niciodată prin internet. Dacă dispozitivele sunt în rețele diferite (de exemplu, unul pe date mobile), asocierea și sincronizarea vor eșua.",
    app_p2pLanWarningHint:
      "Sfat: dezactivați datele mobile de pe telefon și conectați-l la aceeași rețea Wi-Fi ca computerul.",
  },
  ru: {
    app_p2pLanWarningTitle:
      "Оба устройства должны быть в одной сети Wi-Fi",
    app_p2pLanWarningBody:
      "Эта синхронизация работает напрямую между устройствами через вашу локальную сеть, никогда через интернет. Если устройства находятся в разных сетях (например, одно в мобильном интернете), сопряжение и синхронизация не удастся.",
    app_p2pLanWarningHint:
      "Совет: отключите мобильный интернет на телефоне и подключите его к той же сети Wi-Fi, что и компьютер.",
  },
  sv: {
    app_p2pLanWarningTitle:
      "Båda enheterna måste vara på samma Wi-Fi-nätverk",
    app_p2pLanWarningBody:
      "Denna synkronisering fungerar från enhet till enhet via ditt lokala nätverk, aldrig via internet. Om enheterna är på olika nätverk (till exempel en på mobildata) misslyckas ihopkoppling och synkronisering.",
    app_p2pLanWarningHint:
      "Tips: stäng av mobildata på telefonen och anslut den till samma Wi-Fi som datorn.",
  },
  th: {
    app_p2pLanWarningTitle:
      "อุปกรณ์ทั้งสองเครื่องต้องเชื่อมต่อ Wi-Fi เครือข่ายเดียวกัน",
    app_p2pLanWarningBody:
      "การซิงค์นี้ทำงานระหว่างอุปกรณ์ต่ออุปกรณ์ผ่านเครือข่ายท้องถิ่นของคุณ ไม่เคยผ่านอินเทอร์เน็ต หากอุปกรณ์อยู่ในเครือข่ายที่ต่างกัน (เช่น เครื่องหนึ่งใช้เน็ตมือถือ) การจับคู่และการซิงค์จะล้มเหลว",
    app_p2pLanWarningHint:
      "เคล็ดลับ: ปิดเน็ตมือถือในโทรศัพท์แล้วเชื่อมต่อ Wi-Fi เดียวกับคอมพิวเตอร์",
  },
  tr: {
    app_p2pLanWarningTitle:
      "Her iki cihaz da aynı Wi-Fi ağına bağlı olmalıdır",
    app_p2pLanWarningBody:
      "Bu eşitleme, yerel ağınız üzerinden cihazdan cihaza çalışır, asla internet üzerinden değil. Cihazlar farklı ağlarda ise (örneğin biri mobil veri kullanırken), eşleştirme ve eşitleme başarısız olur.",
    app_p2pLanWarningHint:
      "İpucu: telefonunuzun mobil verisini kapatın ve bilgisayarınızla aynı Wi-Fi ağına bağlayın.",
  },
  uk: {
    app_p2pLanWarningTitle:
      "Обидва пристрої мають бути в одній мережі Wi-Fi",
    app_p2pLanWarningBody:
      "Ця синхронізація працює напряму між пристроями через вашу локальну мережу, ніколи через інтернет. Якщо пристрої в різних мережах (наприклад, один у мобільному інтернеті), сполучення та синхронізація не вдасться.",
    app_p2pLanWarningHint:
      "Порада: вимкніть мобільний інтернет на телефоні та підключіть його до тієї ж мережі Wi-Fi, що й комп'ютер.",
  },
  vi: {
    app_p2pLanWarningTitle:
      "Cả hai thiết bị phải cùng kết nối một mạng Wi-Fi",
    app_p2pLanWarningBody:
      "Việc đồng bộ này hoạt động trực tiếp giữa các thiết bị qua mạng cục bộ của bạn, không bao giờ qua internet. Nếu các thiết bị ở mạng khác nhau (ví dụ: một máy dùng dữ liệu di động), việc ghép nối và đồng bộ sẽ thất bại.",
    app_p2pLanWarningHint:
      "Mẹo: tắt dữ liệu di động trên điện thoại và kết nối vào cùng Wi-Fi với máy tính.",
  },
  zh: {
    app_p2pLanWarningTitle: "两台设备必须连接同一个 Wi-Fi 网络",
    app_p2pLanWarningBody:
      "此同步通过您的本地网络在设备之间直接进行，绝不经过互联网。如果两台设备处于不同网络（例如其中一台使用移动数据），配对和同步将会失败。",
    app_p2pLanWarningHint: "提示：请关闭手机的移动数据，并将其连接到与电脑相同的 Wi-Fi。",
  },
};

const KEYS = [
  "app_p2pLanWarningTitle",
  "app_p2pLanWarningBody",
  "app_p2pLanWarningHint",
];

let updated = 0;
let skipped = 0;
for (const file of readdirSync(LOCALES_DIR)) {
  if (!file.endsWith(".json")) {continue;}
  const locale = file.replace(/\.json$/, "");
  const path = join(LOCALES_DIR, file);
  const dict = JSON.parse(readFileSync(path, "utf8"));

  if (KEYS.every((k) => typeof dict[k] === "string" && dict[k].length > 0)) {
    skipped++;
    continue;
  }
  const translations = T[locale];
  if (!translations) {
    console.error(`NO TRANSLATIONS for locale "${locale}" — fix the script.`);
    process.exit(1);
  }
  for (const key of KEYS) {
    if (typeof dict[key] === "string" && dict[key].length > 0) {continue;}
    dict[key] = translations[key];
  }

  // Re-serialize preserving key order, inserting the new keys immediately
  // after "app_p2pUnsupported" so the P2P block stays contiguous.
  const ordered = {};
  for (const [k, v] of Object.entries(dict)) {
    ordered[k] = v;
    if (k === "app_p2pUnsupported") {
      for (const nk of KEYS) {ordered[nk] = dict[nk];}
    }
  }
  // Fallback if the anchor was somehow absent: append at the end.
  for (const nk of KEYS) {
    if (!(nk in ordered)) {ordered[nk] = dict[nk];}
  }

  writeFileSync(path, JSON.stringify(ordered, null, 2) + "\n", "utf8");
  updated++;
}
console.log(
  `P2P LAN keys: ${updated} locale(s) updated, ${skipped} already complete.`,
);
