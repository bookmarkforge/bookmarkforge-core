import fs from 'fs';
import path from 'path';

const translations = {
  ar: { commission: "ستكسب عمولة 30% (عامة) أو 50% (للأعضاء) على كل مستخدم يسجل عبر رابطك" },
  bg: { commission: "Ще печелите 30% (глобална) или 50% (за членове) комисион за всеки потребител, регистриран чрез вашият линк" },
  cs: { commission: "Získáte 30% (globální) nebo 50% (pro členy) provizi za každého uživatele registrovaného přes váš odkaz" },
  da: { commission: "Du tjener 30% (global) eller 50% (for medlemmer) kommission for hver bruger der registrerer via dit link" },
  de: { commission: "Du verdienst 30% (global) oder 50% (für Mitglieder) Provision für jeden Benutzer, der sich über deinen Link registriert" },
  el: { commission: "Θα κερδίσετε 30% (παγκόσμια) ή 50% (για μέλη) προμήθεια για κάθε χρήστη που εγγράφεται μέσω του συνδέσμου σας" },
  en: { commission: "You will earn 30% (global) or 50% (for members) commission for every user who registers through your link" },
  es: { commission: "Ganarás 30% (global) o 50% (para miembros) de comisión por cada usuario que se registre a través de tu enlace" },
  fi: { commission: "Ansaitset 30% (yleinen) tai 50% (jäsenille) provisiot jokaisesta käyttäjästä, joka rekisteröityy linkkisi kautta" },
  fr: { commission: "Vous gagnerez 30% (global) ou 50% (pour les membres) de commission pour chaque utilisateur qui s'inscrit via votre lien" },
  he: { commission: "תרוויח 30% (גלובלי) או 50% (לחברים) עמלה על כל משתמש שנרשם דרך הקישור שלך" },
  hi: { commission: "आप अपने लिंक के माध्यम से पंजीकृत होने वाले प्रत्येक उपयोगकर्ता के लिए 30% (वैश्विक) या 50% (सदस्यों के लिए) कमीशन कमाएंगे" },
  hr: { commission: " zaradit ćete 30% (globalna) ili 50% (za članove) proviziju za svakog korisnika koji se registrira putem vaše poveznice" },
  hu: { commission: "30% (globális) vagy 50% (tagoknak) jutalékot kapsz minden felhasználó után, aki a linked segítségével regisztrál" },
  id: { commission: "Anda akan mendapatkan komisi 30% (global) atau 50% (untuk anggota) untuk setiap pengguna yang mendaftar melalui tautan Anda" },
  it: { commission: "Guadagnerai 30% (globale) o 50% (per i membri) di commissione per ogni utente che si registra tramite il tuo link" },
  ja: { commission: "リンク経由で登録するユーザーごとに30%（グローバル）または50%（メンバー向け）のコミッションを獲得できます" },
  ko: { commission: "링크를 통해 등록하는 모든 사용자에 대해 30%(글로벌) 또는 50%(회원용) 수수료를 받습니다" },
  nl: { commission: "Je verdient 30% (globaal) of 50% (voor leden) commissie voor elke gebruiker die zich via jouw link registreert" },
  no: { commission: "Du tjener 30% (global) eller 50% (for medlemmer) provisjon for hver bruker som registrerer seg via linken din" },
  pl: { commission: "Zarobisz 30% (globalne) lub 50% (dla członków) prowizję za każdego użytkownika, który zarejestruje się przez Twój link" },
  pt: { commission: "Você ganhará 30% (global) ou 50% (para membros) de comissão por cada usuário que se registrar através do seu link" },
  ro: { commission: "Veți câștiga 30% (global) sau 50% (pentru membri) comision pentru fiecare utilizator care se înregistrează prin linkul dvs." },
  ru: { commission: "Вы получите 30% (глобальная) или 50% (для участников) комиссию за каждого пользователя, зарегистрированного по вашей ссылке" },
  sv: { commission: "Du tjänar 30% (global) eller 50% (för medlemmar) provision för varje användare som registrerar sig via din länk" },
  th: { commission: "คุณจะได้รับค่าคอมมิชชั่น 30% (ส่วนกลาง) หรือ 50% (สำหรับสมาชิก) สำหรับผู้ใช้ที่ลงทะเบียนผ่านลิงก์ของคุณ" },
  tr: { commission: "Linkiniz üzerinden kaydolan her kullanıcı için %30 (global) veya %50 (üyeler için) komisyon kazanırsınız" },
  uk: { commission: "Ви отримаєте 30% (глобальна) або 50% (для учасників) комісію за кожного користувача, який зареєструється через ваше посилання" },
  vi: { commission: "Bạn sẽ nhận được 30% (toàn cầu) hoặc 50% (cho thành viên) hoa hồng cho mỗi người dùng đăng ký qua liên kết của bạn" },
  zh: { commission: "通过您的链接注册的每个用户，您将获得30%（全球）或50%（会员）的佣金" }
};

const translationsFile = path.join(process.cwd(), 'scripts', 'landing-translations.json');
const data = JSON.parse(fs.readFileSync(translationsFile, 'utf8'));

Object.keys(translations).forEach(lang => {
  if (data[lang]) {
    data[lang].affiliateCommission = translations[lang].commission;
    console.log(`Updated affiliateCommission for ${lang}`);
  }
});

fs.writeFileSync(translationsFile, JSON.stringify(data, null, 2));
console.log('Done!');
