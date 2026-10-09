# Sade Teknik Türkçe v1

Bir görev veya aşama kapanınca, başarısız kapanış dahil, tek HTML rapor ver.
Hedef: sahibi bir dakikadan kısa sürede sonucu, kapsamı ve açık işi anlasın.
Bu hedef bir okunabilirlik garantisi değildir; ilk raporları sahibiyle dene.
Karpathy atfı araştırmadaki arşivlerle desteklenir; doğrudan okunmadı.
Bu sözleşme CodeXOrch uyarlamasıdır; ASD-STE100 sertifikalı değildir.

## 15 yazım kuralı

1. Sonucu ilk cümlede söyle.
2. Her cümlede tek ana bilgi ver.
3. Genellikle 8–16 kelime kullan; 20 kelimeyi aşınca uyar. Koşulu silme.
4. Bir paragrafta tek konu ve en çok iki cümle kullan.
5. Aktörü biliyorsan belirt; bilinmeyen kişiye eylem atfetme.
6. Doğrudan fiil seç: “ayarı değiştirdi”.
7. Kavram başına tek terim kullan: review → inceleme, configuration → ayar.
8. Model, komut, sürüm, SHA ve dosya kimliklerini aynen koru.
9. Olumsuzluğu ve belirsizliği koru: denenmedi, bilinmiyor, ölçülmedi.
10. Kapsamı sonuç cümlesinde söyle: “Yerel yönlendirme kontrolü geçti.”
11. Yapılan, doğrulanan ve önerilen işi ayır.
12. Sayının neyi saydığını belirt; komut sayısını test sayısı yapma.
13. Riski somut koşul ve etkiyle açıkla.
14. Kanıtsız övgü kullanma: kusursuz, risksiz, tamamen güvenli, sorunsuz.
15. Önemli açık işi görünür tut; teknik ayrıntıyı açılabilir Kanıt içine koy.

## Sabit bölümler ve bütçeler

Başlık yaklaşık 100 karakteri aşmasın. Ana metin hedefi en çok 195 kelimedir.

| Bölüm | JSON anahtarı | Bütçe |
| --- | --- | --- |
| Özet | summary | 2 cümle, 30 kelime |
| Ne değişti? | changes | 3 madde, toplam 45 kelime |
| Doğrulama | verification | 3 kısa satır, toplam 40 kelime |
| Açık kalanlar | open | Normalde 2 madde, toplam 30 kelime |
| Riskler | risks | Normalde 2 madde, toplam 30 kelime |
| Sonraki adım | next | 1 madde, 20 kelime |
| Kanıt | Otomatik açılabilir bölüm | Tam SHA, bağlantılar ve kontrol kapsamı |

Kritik risk ve açık işi bütçeye uymak için gizleme. Uzunluk uyarıdır, ret değildir.
Boş bölüm başarı veya “risk yok” anlamına gelmez; üretici “Olgu verilmedi” yazar.

## Olgu ve kanıt sözleşmesi

Worker tek olgu listesi hazırlar. Mevcut ayrı inceleyen, Türkçe iddiaları da
commit ve kontrol kayıtlarına karşı inceler. Lead onaylanan `text_tr` metnini
yeniden yazmaz. Üretici metni aynen, yalnız HTML kaçışlarıyla gösterir.
Şema: `report.schema.json`. Bir nesne bir görev/aşama raporudur.

Claude Code içinde `/codexorch-report` komutu **CodeXOrch** panelini açar.
Aktif Orca Run varsa, istem üstündeki **Rapor** düğmesi de paneli açar.
Şerit hedefi ve worker durumlarını gösterir; soru bekleyen worker ayrıca belirtilir.
Yeni rapor için “Rapor hazır” bildirimi görünür. Kanıt listesi başlangıçta kapalıdır.
Üretici aynı onaylı JSON ve HTML dosyalarını `/tmp/codexorch-reports/` altında tutar.
`latest.json`, son raporun `report_path` ve `html_path` yollarını içerir.
Panel metni değiştirmez; `unknown` ve `not_run` değerlerini görünür tutar.
HTML bağlantısı yerel dosyayı açar; uzak yüzeyde yerel bağlantı açılamayabilir.
Orca açıksa rapor üretilince Orca browser'ında yeni sekmede açılır; Orca yoksa bu adım atlanır.
UI yalnız yerel okuma yapar. Orca yoksa veya Run bağlı değilse şerit görünmez.
Run yokken zamanlayıcı durur; komut ve tamamlanan tur raporu tekrar okur.

- Her iddia bir commit, kontrol veya inceleme kaydına `evidence_refs` ile bağlıdır.
- Kaynak kimliği ve kapsam iddianın içinde belirtilir. Bağlantı tek başına doğruluk kanıtı değildir.
- `commit` kaynak commit kaydıdır; `review` incelemedir; diğer kimlikler `checks[].id` değeridir.
- Tam 40 haneli SHA kullan. Bilinmeyen SHA, URL ve kimlik için `null` kullan.
- İnceleme ve kontrol SHA biliniyorsa kaynak SHA ile aynı olmalıdır; farklıysa yeni rapor hazırla.
- `unknown` ve `not_run` görünür kalır. `not_run` geçti sayılmaz; eksik kayıt doğrulama değildir.
- `certainty`: verified (kanıtla doğrulandı), inferred (çıkarım), unknown (bilinmiyor).
- `kind`: change, verification, open, risk, next. Sonraki adımı tamamlanmış iş sayma.
- Her olgu en az bir bölümde görünür. Tüm referanslar var olan kayıtlara açılır.
- Kanıt URLsi yalnız HTTPS olabilir; commit/dosya URLlerini tam SHAya sabitle.
- Ham günlük, sır ve kişisel veri koyma. Kontrol metnine komut, kapsam ve gözlenen sonucu yaz.
- İnceleme verdict alanı approved, changes_requested, unverified veya unknown olabilir.
  Approved dışındaki durumlar gizlenmez; rapor üretmek inceleme onayı anlamına gelmez.
- Üretici anlamsal doğruluğu, bağlantının içeriğini veya inceleyenin kimliğini doğrulamaz.
  Mevcut inceleyen bunları denetler; otomatik metin düzeltme, LLM ve yaşam döngüsü çağrısı yoktur.

## Teslim

Lead kapanışta olguları worker’dan alır ve mevcut inceleyene Türkçe iddiaları kontrol ettirir.
Şemaya uygun JSONu `/tmp` içine yazıp kurulu referans dizininden çalıştırır:

```sh
node render-report.mjs /tmp/task-report.json /tmp/task-report.html
```

Sahibe HTML dosya yolunu ver. `/tmp` kalıcı arşiv değildir. Hata varsa rapor hatasını
bildir; ürün worker’ını rapor biçimi için tekrar başlatma. Dil uyarıları metni değiştirmez.
Örnek iddia: “Yerel yönlendirme kontrolü geçti; canlı kullanım denenmedi.”
