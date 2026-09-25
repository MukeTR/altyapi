const pricelists = {
  title: "Fiyat listeleri",
  description: "Liste fiyatı her para biriminde temel fiyattır; indirim ve zamanlanmış listeler önceliğe göre onun yerine geçer.",
  add: "Fiyat listesi oluştur",
  created: "Fiyat listesi oluşturuldu.",
  deleted: "Fiyat listesi silindi.",
  empty: "Fiyat listesi yok.",
  always: "Her zaman",
  openEnded: "süresiz",
  delete: "{name} listesini sil",
  deleteTitle: "“{name}” silinsin mi?",
  deleteBody: "Listedeki fiyatlar hemen geçersiz olur ve ürünler diğer listelerin fiyatına döner. Fiyat geçmişi korunur.",
  columns: {
    name: "Ad",
    kind: "Tür",
    currency: "Para birimi",
    priority: "Öncelik",
    schedule: "Geçerlilik",
    status: "Durum",
  },
  fields: {
    name: "Ad",
    namePlaceholder: "Örn. Yaz indirimi",
    kind: "Tür",
    currency: "Para birimi",
    priority: "Öncelik",
    priorityHint: "Aynı anda birden fazla liste geçerliyse yüksek öncelikli olan kazanır (−1000 ile 1000).",
    startsAt: "Başlangıç",
    endsAt: "Bitiş",
  },
  kindHints: {
    sale: "Oluşturulduğu andan itibaren geçerli.",
    scheduled: "Yalnızca belirlediğiniz zaman aralığında geçerli.",
  },
};

export default pricelists;
