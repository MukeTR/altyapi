/** Text shared by the commerce screens (orders, products, inventory, imports). */
const commerce = {
  tags: {
    placeholder: "Etiket yazıp Enter'a basın",
    hint: "Enter veya virgül etiketi ekler; boş alanda Geri tuşu son etiketi siler.",
    list: "Etiketler",
    remove: "{tag} etiketini kaldır",
  },
  quantity: {
    decrease: "{name}: azalt",
    increase: "{name}: artır",
  },
  filters: {
    all: "Tümü",
    clear: "Filtreleri temizle",
    from: "Başlangıç",
    to: "Bitiş",
    dateRange: "Tarih aralığı",
    anyPayment: "Tüm ödeme durumları",
  },
  noPermission: "Bu işlem için yetkiniz yok ({permission}).",
  unsaved: "Kaydedilmemiş değişiklikler",
  savedToast: "Değişiklikler kaydedildi.",
  loadMoreFailed: "Liste yüklenemedi.",
};

export default commerce;
