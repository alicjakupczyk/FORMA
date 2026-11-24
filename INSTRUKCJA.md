# Forma – instrukcja uruchomienia krok po kroku

Wykonaj kroki po kolei. Każdy robisz tylko raz.

---

## Krok 1. Przygotuj bazę danych w Supabase (5 minut)

1. Wejdź na **supabase.com** i otwórz swój projekt.
2. W lewym menu kliknij ikonę **SQL Editor** (wygląda jak okienko z `>_`).
3. Kliknij **+ New query** (albo „New SQL snippet”).
4. Otwórz plik **`supabase/schema.sql`** z tego folderu (np. w Notatniku), zaznacz wszystko (**Ctrl+A**), skopiuj (**Ctrl+C**).
5. Wklej w Supabase (**Ctrl+V**) i kliknij zielony przycisk **Run** (prawy dolny róg).
6. Na dole powinien pojawić się napis **Success. No rows returned**. To dobrze! ✅
   - Jeśli pojawi się okienko z ostrzeżeniem o „destructive operation” – kliknij **Run this query** (skrypt tylko zakłada zabezpieczenia, niczego nie usuwa z Twoich danych).

## Krok 2. Ustaw logowanie w Supabase (2 minuty)

1. W lewym menu kliknij **Authentication** (ikona ludzika).
2. Wejdź w **Sign In / Providers** (lub **Providers**), kliknij **Email**.
3. **Wyłącz** opcję **Confirm email** i kliknij **Save**.
   *(Dzięki temu nie musisz klikać linku w mailu przy zakładaniu konta.)*

> Rejestrację nowych kont wyłączymy w kroku 6 – dopiero gdy założysz swoje.

## Krok 3. Ukryj swój e-mail na GitHubie (1 minuta)

1. Na **github.com** kliknij swoje zdjęcie (prawy górny róg) → **Settings**.
2. W lewym menu kliknij **Emails**.
3. Zaznacz **Keep my email addresses private**.

## Krok 4. Wgraj aplikację na GitHub (10 minut)

1. Na github.com kliknij **+** (prawy górny róg) → **New repository**.
2. **Repository name:** `forma` (tak będzie się nazywać adres).
3. Zaznacz **Public**. Nic więcej nie zmieniaj. Kliknij **Create repository**.
4. Na następnej stronie kliknij link **uploading an existing file**.
5. Otwórz folder z aplikacją w Eksploratorze plików. Zaznacz **całą zawartość folderu** (Ctrl+A):
   `css`, `icons`, `js`, `supabase`, `index.html`, `manifest.webmanifest`, `sw.js`, `INSTRUKCJA.md`
   i **przeciągnij** je myszką na stronę GitHuba (w szare pole).
   - Ważne: przeciągnij to, co jest **w środku** folderu, a nie sam folder.
6. Poczekaj, aż wszystkie pliki się wgrają. Na dole kliknij zielony **Commit changes**.
7. Wejdź w **Settings** (zakładka u góry repozytorium) → w lewym menu **Pages**.
8. W sekcji **Build and deployment** → **Source:** wybierz **Deploy from a branch**.
   **Branch:** wybierz **main**, obok zostaw **/ (root)** i kliknij **Save**.
9. Poczekaj 1–2 minuty i odśwież stronę. U góry pojawi się adres w stylu:
   **`https://TWOJA-NAZWA.github.io/forma/`** – to adres Twojej aplikacji! 🎉

## Krok 5. Załóż konto w aplikacji

1. Otwórz adres aplikacji na komputerze.
2. Kliknij **Pierwszy raz? Załóż konto**, wpisz e-mail i hasło (zapisz je w menedżerze haseł).
3. Przejdź przez 3 kroki: dane → cel → podsumowanie.
4. Wejdź w zakładkę **Profil** → wklej **klucz Gemini** (ten `AIza…` z Google AI Studio) → **Zapisz klucz**.

## Krok 6. Zablokuj rejestrację obcym (1 minuta)

1. W Supabase: **Authentication** → **Sign In / Providers** (albo **Settings**).
2. Wyłącz **Allow new users to sign up** i kliknij **Save**.

Od teraz nikt poza Tobą nie założy konta w Twojej aplikacji.

## Krok 7. Dodaj aplikację do ekranu iPhone'a

1. Na iPhonie otwórz adres aplikacji w **Safari** (koniecznie Safari).
2. Kliknij przycisk **Udostępnij** (kwadrat ze strzałką w górę, na dole ekranu).
3. Przewiń w dół i wybierz **Do ekranu początkowego** → **Dodaj**.
4. Otwórz aplikację z ikony **F** na ekranie, zaloguj się i **wklej klucz Gemini w Profilu jeszcze raz**
   (klucz zapisuje się osobno na każdym urządzeniu).
5. Przy pierwszym zdjęciu lub skanowaniu iPhone zapyta o dostęp do aparatu – wybierz **Pozwól**.

---

## Jak wgrać nową wersję (gdy coś zmienimy)

1. Na GitHubie wejdź w repozytorium `forma` → **Add file** → **Upload files**.
2. Przeciągnij zmienione pliki (albo całą zawartość folderu jeszcze raz) → **Commit changes**.
3. Po 1–2 minutach nowa wersja będzie dostępna. Na iPhonie zamknij i otwórz aplikację.

## Gdy coś nie działa

| Komunikat | Co zrobić |
|---|---|
| „Baza danych nie jest jeszcze przygotowana” | Wykonaj krok 1. |
| „E-mail nie jest potwierdzony” | Wykonaj krok 2 albo kliknij link w mailu od Supabase. |
| „Wykorzystany darmowy limit Gemini” | Odczekaj minutę lub do jutra. W międzyczasie użyj Bazy lub wpisz ręcznie. |
| „Model … jest niedostępny” | Profil → Ustawienia zaawansowane → wpisz `gemini-2.5-flash`. |
| Aplikacja się nie ładuje | Jeśli nie używałaś jej ponad tydzień, Supabase „usypia” projekt – zaloguj się na supabase.com i kliknij **Restore project**. |
