/** Settings › General (store name, languages, currencies, region, status). */
const settings = {
  readOnlyTitle: "Yalnızca görüntüleme",
  readOnlyBody: "Bu ayarları değiştirmek için {permission} yetkisi gerekir.",
  general: {
    title: "Genel ayarlar",
    meta: "Mağazanın adı, içerik dilleri, para birimleri, saat dilimi ve durumu.",
    saved: "Ayarlar kaydedildi",
    identity: {
      title: "Mağaza",
      description: "Yönetim panelinde ve bildirimlerde görünen ad. Mağaza adresi (slug) oluşturulduktan sonra değişmez.",
      name: "Mağaza adı",
      slug: "Mağaza adresi",
      slugHelp: "Platform alt alan adınızın parçasıdır ve kalıcıdır.",
    },
    languages: {
      title: "İçerik dilleri",
      description: "Ürün, sayfa ve menü metinlerini hangi dillerde yayınlayacağınızı seçin. Varsayılan dil, çevirisi olmayan metinler için kullanılır.",
      supported: "Yayın dilleri",
      supportedHelp: "Seçtiğiniz her dil için içerik alanlarında ayrı bir metin kutusu açılır.",
      default: "Varsayılan dil",
      defaultHelp: "Yayın dillerinden biri olmalıdır.",
      defaultLocked: "Varsayılan dil kaldırılamaz; önce başka bir varsayılan dil seçin.",
      rtl: "Sağdan sola",
      rtlNote: "Sağdan sola yazılan diller (Arapça, Farsça) vitrinde ayna düzeninde gösterilir; bu dillerdeki metin alanları da sağdan sola açılır.",
    },
    currencies: {
      title: "Para birimleri",
      description: "Fiyat listelerinde ve kargo ücretlerinde kullanılabilecek para birimleri.",
      default: "Varsayılan para birimi",
      defaultHelp: "Mağaza oluşturulurken seçilir ve değiştirilemez; temel fiyat listesi bu para birimindedir.",
      supported: "Kabul edilen para birimleri",
      supportedHelp: "Varsayılan para birimi her zaman listededir.",
      search: "Para birimi ara…",
    },
    region: {
      title: "Bölge ve saat",
      description: "Siparişler, raporlar ve zamanlanmış yayınlar bu saat dilimine göre gösterilir.",
      timezone: "Saat dilimi",
      timezoneHelp: "Örnek: Europe/Istanbul.",
      searchTimezone: "Saat dilimi ara…",
      country: "Ülke",
      countryHelp: "Mağaza oluşturulurken seçilir; vergi ve kargo varsayılanlarını belirler.",
    },
    status: {
      title: "Mağaza durumu",
      description: "Vitrinin ziyaretçilere ve siparişlere açık olup olmadığını belirler.",
      closed: "Bu mağaza kapatılmış. Kapalı bir mağazanın durumu buradan değiştirilemez.",
      help: {
        setup: "Kurulum sürüyor; vitrin yayında olsa da mağaza henüz açılmamış kabul edilir.",
        active: "Mağaza açık; ziyaretçiler alışveriş yapabilir.",
        paused: "Mağaza geçici olarak kapalı; yeni sipariş alınmaz.",
      },
    },
  },
};

export default settings;
