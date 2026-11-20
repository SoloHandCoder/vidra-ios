// App languages. Follows the phone / computer language unless one is picked
// in Settings. Works as a light translation layer over the rendered UI: text
// nodes and placeholder / title / aria-label attributes that exactly match an
// English string are swapped for the translation (a few patterns handle
// numbers and names). Movie and show titles, overviews and other TMDB data
// are not touched; their language comes from the TMDB metadata language.

export const LANGUAGES = [
  { code: "en", name: "English", tmdb: "en-US" },
  { code: "de", name: "Deutsch", tmdb: "de-DE" },
  { code: "es", name: "Español", tmdb: "es-ES" },
  { code: "fr", name: "Français", tmdb: "fr-FR" },
  { code: "it", name: "Italiano", tmdb: "it-IT" },
  { code: "pt", name: "Português", tmdb: "pt-BR" },
];
const ORDER = ["de", "es", "fr", "it", "pt"];
const SETTING = "streambert_appLanguage"; // "system" | code

// [English, Deutsch, Español, Français, Italiano, Português]
const T = [
  // navigation
  ["Home", "Start", "Inicio", "Accueil", "Home", "Início"],
  ["Search", "Suche", "Buscar", "Recherche", "Cerca", "Buscar"],
  ["Library", "Mediathek", "Biblioteca", "Bibliothèque", "Libreria", "Biblioteca"],
  ["Downloads", "Downloads", "Descargas", "Téléchargements", "Download", "Downloads"],
  ["Settings", "Einstellungen", "Ajustes", "Paramètres", "Impostazioni", "Configurações"],
  ["Library & History", "Mediathek & Verlauf", "Biblioteca e historial", "Bibliothèque et historique", "Libreria e cronologia", "Biblioteca e histórico"],
  ["Back", "Zurück", "Atrás", "Retour", "Indietro", "Voltar"],
  ["‹ Back", "‹ Zurück", "‹ Atrás", "‹ Retour", "‹ Indietro", "‹ Voltar"],
  ["Close", "Schließen", "Cerrar", "Fermer", "Chiudi", "Fechar"],
  ["Cancel", "Abbrechen", "Cancelar", "Annuler", "Annulla", "Cancelar"],
  ["Save", "Speichern", "Guardar", "Enregistrer", "Salva", "Salvar"],
  ["Delete", "Löschen", "Eliminar", "Supprimer", "Elimina", "Excluir"],
  ["Remove", "Entfernen", "Quitar", "Retirer", "Rimuovi", "Remover"],
  ["Rename", "Umbenennen", "Renombrar", "Renommer", "Rinomina", "Renomear"],
  ["Create", "Erstellen", "Crear", "Créer", "Crea", "Criar"],
  ["Done", "Fertig", "Listo", "Terminé", "Fatto", "Pronto"],
  ["Retry", "Erneut versuchen", "Reintentar", "Réessayer", "Riprova", "Tentar de novo"],
  ["Try again", "Erneut versuchen", "Reintentar", "Réessayer", "Riprova", "Tentar de novo"],
  ["Try Again", "Erneut versuchen", "Reintentar", "Réessayer", "Riprova", "Tentar de novo"],
  ["Refresh", "Aktualisieren", "Actualizar", "Actualiser", "Aggiorna", "Atualizar"],
  ["Checking…", "Wird geprüft…", "Comprobando…", "Vérification…", "Verifica…", "Verificando…"],
  ["Change", "Ändern", "Cambiar", "Modifier", "Cambia", "Alterar"],
  ["Switch", "Wechseln", "Cambiar", "Changer", "Cambia", "Trocar"],
  ["Confirm", "Bestätigen", "Confirmar", "Confirmer", "Conferma", "Confirmar"],
  ["Dismiss", "Ausblenden", "Descartar", "Ignorer", "Ignora", "Dispensar"],
  ["More", "Mehr", "Más", "Plus", "Altro", "Mais"],
  ["Next", "Weiter", "Siguiente", "Suivant", "Avanti", "Próximo"],
  ["Previous", "Zurück", "Anterior", "Précédent", "Precedente", "Anterior"],
  ["Off", "Aus", "No", "Désactivé", "Off", "Desligado"],
  ["Skip for now", "Vorerst überspringen", "Omitir por ahora", "Plus tard", "Salta per ora", "Pular por enquanto"],
  ["Let's go", "Los geht's", "Vamos", "C'est parti", "Iniziamo", "Vamos lá"],
  // home
  ["Continue Watching", "Weiterschauen", "Seguir viendo", "Reprendre", "Continua a guardare", "Continuar assistindo"],
  ["Recommended for You", "Für dich empfohlen", "Recomendado para ti", "Recommandé pour vous", "Consigliati per te", "Recomendado para você"],
  ["Trending Movies", "Angesagte Filme", "Películas en tendencia", "Films tendance", "Film di tendenza", "Filmes em alta"],
  ["Trending Series", "Angesagte Serien", "Series en tendencia", "Séries tendance", "Serie di tendenza", "Séries em alta"],
  ["Top Rated", "Bestbewertet", "Mejor valoradas", "Les mieux notés", "Più votati", "Mais bem avaliados"],
  ["Coming up", "Demnächst", "Próximamente", "À venir", "In arrivo", "Em breve"],
  ["Calendar ›", "Kalender ›", "Calendario ›", "Calendrier ›", "Calendario ›", "Calendário ›"],
  ["Watch Now", "Jetzt ansehen", "Ver ahora", "Regarder", "Guarda ora", "Assistir agora"],
  ["More Info", "Mehr Infos", "Más info", "Plus d'infos", "Più info", "Mais info"],
  ["No internet connection", "Keine Internetverbindung", "Sin conexión a internet", "Pas de connexion Internet", "Nessuna connessione Internet", "Sem conexão com a internet"],
  ["Today", "Heute", "Hoy", "Aujourd'hui", "Oggi", "Hoje"],
  ["Tomorrow", "Morgen", "Mañana", "Demain", "Domani", "Amanhã"],
  ["Movie release", "Filmstart", "Estreno", "Sortie du film", "Uscita del film", "Estreia"],
  // detail pages
  ["Play", "Abspielen", "Reproducir", "Lecture", "Riproduci", "Reproduzir"],
  ["Play Now", "Jetzt abspielen", "Reproducir", "Lire maintenant", "Riproduci ora", "Reproduzir agora"],
  ["Trailer", "Trailer", "Tráiler", "Bande-annonce", "Trailer", "Trailer"],
  ["Cast", "Besetzung", "Reparto", "Distribution", "Cast", "Elenco"],
  ["Cast to TV", "Auf TV streamen", "Enviar a la TV", "Caster sur la TV", "Trasmetti alla TV", "Transmitir para a TV"],
  ["Saved", "Gemerkt", "Guardado", "Enregistré", "Salvato", "Salvo"],
  ["Watched", "Gesehen", "Visto", "Vu", "Visto", "Assistido"],
  ["✓ Mark Watched", "✓ Als gesehen markieren", "✓ Marcar como visto", "✓ Marquer comme vu", "✓ Segna come visto", "✓ Marcar como assistido"],
  ["Mark as Watched", "Als gesehen markieren", "Marcar como visto", "Marquer comme vu", "Segna come visto", "Marcar como assistido"],
  ["Mark as Unwatched", "Als ungesehen markieren", "Marcar como no visto", "Marquer comme non vu", "Segna come non visto", "Marcar como não assistido"],
  ["Episodes", "Folgen", "Episodios", "Épisodes", "Episodi", "Episódios"],
  ["Movie", "Film", "Película", "Film", "Film", "Filme"],
  ["Series", "Serie", "Serie", "Série", "Serie", "Série"],
  ["Directors", "Regie", "Dirección", "Réalisation", "Regia", "Direção"],
  ["Writers", "Drehbuch", "Guion", "Scénario", "Sceneggiatura", "Roteiro"],
  ["Creators", "Idee", "Creadores", "Créateurs", "Ideatori", "Criadores"],
  ["Up Next", "Als Nächstes", "A continuación", "À suivre", "Prossimo", "A seguir"],
  ["Unreleased", "Noch nicht erschienen", "Sin estrenar", "Pas encore sorti", "Non ancora uscito", "Não lançado"],
  ["This movie has not been released yet", "Dieser Film ist noch nicht erschienen", "Esta película aún no se ha estrenado", "Ce film n'est pas encore sorti", "Questo film non è ancora uscito", "Este filme ainda não foi lançado"],
  ["Change source", "Quelle wechseln", "Cambiar fuente", "Changer de source", "Cambia fonte", "Trocar fonte"],
  ["Download", "Herunterladen", "Descargar", "Télécharger", "Scarica", "Baixar"],
  ["Add to list", "Zu Liste hinzufügen", "Añadir a lista", "Ajouter à une liste", "Aggiungi a lista", "Adicionar à lista"],
  ["Rate", "Bewerten", "Valorar", "Noter", "Valuta", "Avaliar"],
  ["Tap a star", "Tippe auf einen Stern", "Toca una estrella", "Touchez une étoile", "Tocca una stella", "Toque numa estrela"],
  ["Didn't like it", "Hat mir nicht gefallen", "No me gustó", "Pas aimé", "Non mi è piaciuto", "Não gostei"],
  ["It was OK", "War okay", "Estuvo bien", "C'était correct", "Era ok", "Foi ok"],
  ["Liked it", "Gefallen", "Me gustó", "Aimé", "Mi è piaciuto", "Gostei"],
  ["Really liked it", "Sehr gefallen", "Me gustó mucho", "Beaucoup aimé", "Mi è piaciuto molto", "Gostei muito"],
  ["Loved it", "Geliebt", "Me encantó", "Adoré", "Adorato", "Amei"],
  ["Remove my rating", "Meine Bewertung entfernen", "Quitar mi valoración", "Retirer ma note", "Rimuovi il mio voto", "Remover minha avaliação"],
  ["No lists yet. Make your first one below.", "Noch keine Listen. Erstelle unten deine erste.", "Aún no hay listas. Crea la primera abajo.", "Pas encore de liste. Créez la première ci-dessous.", "Nessuna lista. Crea la prima qui sotto.", "Nenhuma lista ainda. Crie a primeira abaixo."],
  ["New list name (e.g. Halloween)", "Name der neuen Liste (z. B. Halloween)", "Nombre de la lista (p. ej. Halloween)", "Nom de la liste (ex. Halloween)", "Nome della lista (es. Halloween)", "Nome da lista (ex.: Halloween)"],
  ["List name", "Listenname", "Nombre de la lista", "Nom de la liste", "Nome della lista", "Nome da lista"],
  ["New list", "Neue Liste", "Nueva lista", "Nouvelle liste", "Nuova lista", "Nova lista"],
  ["Rename list", "Liste umbenennen", "Renombrar lista", "Renommer la liste", "Rinomina lista", "Renomear lista"],
  ["Delete list", "Liste löschen", "Eliminar lista", "Supprimer la liste", "Elimina lista", "Excluir lista"],
  ["Remove from list", "Aus Liste entfernen", "Quitar de la lista", "Retirer de la liste", "Rimuovi dalla lista", "Remover da lista"],
  ["The titles stay in your library; only the list goes away.", "Die Titel bleiben in deiner Mediathek, nur die Liste wird gelöscht.", "Los títulos se quedan en tu biblioteca; solo se borra la lista.", "Les titres restent dans votre bibliothèque ; seule la liste disparaît.", "I titoli restano in libreria; viene eliminata solo la lista.", "Os títulos ficam na biblioteca; só a lista é apagada."],
  // library
  ["My Library", "Meine Mediathek", "Mi biblioteca", "Ma bibliothèque", "La mia libreria", "Minha biblioteca"],
  ["Watch history, progress, and saved titles", "Verlauf, Fortschritt und gemerkte Titel", "Historial, progreso y títulos guardados", "Historique, progression et titres enregistrés", "Cronologia, progressi e titoli salvati", "Histórico, progresso e títulos salvos"],
  ["Watch History", "Verlauf", "Historial", "Historique", "Cronologia", "Histórico"],
  ["My Lists", "Meine Listen", "Mis listas", "Mes listes", "Le mie liste", "Minhas listas"],
  ["+ New list", "+ Neue Liste", "+ Nueva lista", "+ Nouvelle liste", "+ Nuova lista", "+ Nova lista"],
  ["Watch Stats", "Statistik", "Estadísticas", "Statistiques", "Statistiche", "Estatísticas"],
  ["See all ›", "Alle ansehen ›", "Ver todo ›", "Tout voir ›", "Vedi tutto ›", "Ver tudo ›"],
  ["last 7 days", "letzte 7 Tage", "últimos 7 días", "7 derniers jours", "ultimi 7 giorni", "últimos 7 dias"],
  ["day streak", "Tage in Folge", "días seguidos", "jours d'affilée", "giorni di fila", "dias seguidos"],
  ["all time", "insgesamt", "en total", "au total", "in totale", "no total"],
  ["Most watched", "Am meisten gesehen", "Lo más visto", "Le plus regardé", "Il più visto", "Mais assistido"],
  ["longest streak (days)", "längste Serie (Tage)", "racha más larga (días)", "plus longue série (jours)", "serie più lunga (giorni)", "maior sequência (dias)"],
  ["biggest day", "stärkster Tag", "día récord", "plus grosse journée", "giorno record", "maior dia"],
  ["busiest month", "aktivster Monat", "mes más activo", "mois le plus chargé", "mese più attivo", "mês mais ativo"],
  ["By month", "Nach Monat", "Por mes", "Par mois", "Per mese", "Por mês"],
  ["Top genres", "Top-Genres", "Géneros principales", "Genres préférés", "Generi preferiti", "Gêneros favoritos"],
  ["Top titles", "Top-Titel", "Títulos principales", "Titres préférés", "Titoli preferiti", "Títulos favoritos"],
  ["Nothing here yet", "Hier ist noch nichts", "Aún no hay nada", "Rien pour l'instant", "Ancora niente", "Nada por aqui ainda"],
  ["Start watching a movie or series and your history will appear here.", "Schau einen Film oder eine Serie, dann erscheint hier dein Verlauf.", "Empieza a ver una película o serie y tu historial aparecerá aquí.", "Commencez un film ou une série et votre historique apparaîtra ici.", "Inizia a guardare un film o una serie e la cronologia apparirà qui.", "Comece a assistir um filme ou série e seu histórico aparecerá aqui."],
  ["Remove from history", "Aus Verlauf entfernen", "Quitar del historial", "Retirer de l'historique", "Rimuovi dalla cronologia", "Remover do histórico"],
  ["Custom order", "Eigene Reihenfolge", "Orden personalizado", "Ordre personnalisé", "Ordine personalizzato", "Ordem personalizada"],
  ["A-Z", "A–Z", "A-Z", "A-Z", "A-Z", "A-Z"],
  ["Top rated", "Bestbewertet", "Mejor valoradas", "Mieux notés", "Più votati", "Mais bem avaliados"],
  ["Newest first", "Neueste zuerst", "Más recientes primero", "Plus récents d'abord", "Più recenti prima", "Mais recentes primeiro"],
  ["My rating", "Meine Bewertung", "Mi valoración", "Ma note", "Il mio voto", "Minha avaliação"],
  ["Title A-Z", "Titel A–Z", "Título A-Z", "Titre A-Z", "Titolo A-Z", "Título A-Z"],
  // downloads
  ["Active", "Aktiv", "Activas", "En cours", "Attivi", "Ativos"],
  ["Paused", "Pausiert", "En pausa", "En pause", "In pausa", "Pausado"],
  ["Failed", "Fehlgeschlagen", "Error", "Échec", "Non riuscito", "Falhou"],
  ["Completed", "Fertig", "Completada", "Terminé", "Completato", "Concluído"],
  ["Watch", "Ansehen", "Ver", "Regarder", "Guarda", "Assistir"],
  ["Resume", "Fortsetzen", "Reanudar", "Reprendre", "Riprendi", "Retomar"],
  ["Pause", "Pause", "Pausa", "Pause", "Pausa", "Pausar"],
  ["Not started", "Nicht begonnen", "Sin empezar", "Pas commencé", "Non iniziato", "Não iniciado"],
  ["No downloads yet", "Noch keine Downloads", "Aún no hay descargas", "Aucun téléchargement", "Nessun download", "Nenhum download ainda"],
  ["Local Files", "Lokale Dateien", "Archivos locales", "Fichiers locaux", "File locali", "Arquivos locais"],
  ["Show in folder", "Im Ordner zeigen", "Mostrar en carpeta", "Afficher dans le dossier", "Mostra nella cartella", "Mostrar na pasta"],
  ["Filter downloads…", "Downloads filtern…", "Filtrar descargas…", "Filtrer les téléchargements…", "Filtra download…", "Filtrar downloads…"],
  ["Sort by", "Sortieren nach", "Ordenar por", "Trier par", "Ordina per", "Ordenar por"],
  ["Date", "Datum", "Fecha", "Date", "Data", "Data"],
  ["Name", "Name", "Nombre", "Nom", "Nome", "Nome"],
  ["Size", "Größe", "Tamaño", "Taille", "Dimensione", "Tamanho"],
  ["Type", "Typ", "Tipo", "Type", "Tipo", "Tipo"],
  ["Download complete", "Download fertig", "Descarga completada", "Téléchargement terminé", "Download completato", "Download concluído"],
  ["Downloaded subtitles", "Heruntergeladene Untertitel", "Subtítulos descargados", "Sous-titres téléchargés", "Sottotitoli scaricati", "Legendas baixadas"],
  ["No subtitles", "Keine Untertitel", "Sin subtítulos", "Pas de sous-titres", "Nessun sottotitolo", "Sem legendas"],
  ["Stop", "Stopp", "Detener", "Arrêter", "Ferma", "Parar"],
  // search
  ["Search movies and series...", "Filme und Serien suchen …", "Buscar películas y series...", "Rechercher des films et séries...", "Cerca film e serie...", "Buscar filmes e séries..."],
  ["Recent searches", "Letzte Suchen", "Búsquedas recientes", "Recherches récentes", "Ricerche recenti", "Buscas recentes"],
  ["Search for movies and series", "Nach Filmen und Serien suchen", "Busca películas y series", "Recherchez des films et séries", "Cerca film e serie", "Busque filmes e séries"],
  ["Search by voice", "Sprachsuche", "Buscar por voz", "Recherche vocale", "Ricerca vocale", "Buscar por voz"],
  ["Voice input isn't available on this device.", "Spracheingabe ist auf diesem Gerät nicht verfügbar.", "La entrada de voz no está disponible en este dispositivo.", "La saisie vocale n'est pas disponible sur cet appareil.", "L'input vocale non è disponibile su questo dispositivo.", "A entrada de voz não está disponível neste aparelho."],
  ["Clear", "Leeren", "Borrar", "Effacer", "Cancella", "Limpar"],
  ["Clear all", "Alle löschen", "Borrar todo", "Tout effacer", "Cancella tutto", "Limpar tudo"],
  // player / subtitles
  ["Subtitles", "Untertitel", "Subtítulos", "Sous-titres", "Sottotitoli", "Legendas"],
  ["Subtitle style", "Untertitel-Stil", "Estilo de subtítulos", "Style des sous-titres", "Stile sottotitoli", "Estilo das legendas"],
  ["Timing", "Timing", "Sincronización", "Synchronisation", "Sincronizzazione", "Sincronia"],
  ["Small", "Klein", "Pequeño", "Petit", "Piccolo", "Pequeno"],
  ["Medium", "Mittel", "Mediano", "Moyen", "Medio", "Médio"],
  ["Large", "Groß", "Grande", "Grand", "Grande", "Grande"],
  ["Extra large", "Sehr groß", "Muy grande", "Très grand", "Molto grande", "Muito grande"],
  ["White", "Weiß", "Blanco", "Blanc", "Bianco", "Branco"],
  ["Yellow", "Gelb", "Amarillo", "Jaune", "Giallo", "Amarelo"],
  ["Cyan", "Cyan", "Cian", "Cyan", "Ciano", "Ciano"],
  ["Green", "Grün", "Verde", "Vert", "Verde", "Verde"],
  ["Dark box", "Dunkler Kasten", "Caja oscura", "Fond sombre", "Riquadro scuro", "Caixa escura"],
  ["Black box", "Schwarzer Kasten", "Caja negra", "Fond noir", "Riquadro nero", "Caixa preta"],
  ["Outline", "Umriss", "Contorno", "Contour", "Contorno", "Contorno"],
  ["Bottom", "Unten", "Abajo", "En bas", "In basso", "Embaixo"],
  ["Higher", "Höher", "Más arriba", "Plus haut", "Più in alto", "Mais alto"],
  ["Top", "Oben", "Arriba", "En haut", "In alto", "Em cima"],
  ["Color", "Farbe", "Color", "Couleur", "Colore", "Cor"],
  ["Background", "Hintergrund", "Fondo", "Fond", "Sfondo", "Fundo"],
  ["Position", "Position", "Posición", "Position", "Posizione", "Posição"],
  ["Reset", "Zurücksetzen", "Restablecer", "Réinitialiser", "Reimposta", "Redefinir"],
  ["Reset to default", "Auf Standard zurücksetzen", "Restablecer", "Valeurs par défaut", "Ripristina predefiniti", "Restaurar padrão"],
  ["This is how subtitles look", "So sehen Untertitel aus", "Así se ven los subtítulos", "Voici l'apparence des sous-titres", "Ecco come appaiono i sottotitoli", "É assim que as legendas ficam"],
  // settings (groups and common rows)
  ["SETTINGS", "EINSTELLUNGEN", "AJUSTES", "PARAMÈTRES", "IMPOSTAZIONI", "CONFIGURAÇÕES"],
  ["Search settings…", "Einstellungen durchsuchen …", "Buscar ajustes…", "Rechercher un paramètre…", "Cerca impostazioni…", "Buscar configurações…"],
  ["Jump to Section", "Zum Bereich springen", "Ir a la sección", "Aller à la section", "Vai alla sezione", "Ir para a seção"],
  ["General", "Allgemein", "General", "Général", "Generale", "Geral"],
  ["Updates & API", "Updates & API", "Actualizaciones y API", "Mises à jour et API", "Aggiornamenti e API", "Atualizações e API"],
  ["Content", "Inhalte", "Contenido", "Contenu", "Contenuti", "Conteúdo"],
  ["Playback", "Wiedergabe", "Reproducción", "Lecture", "Riproduzione", "Reprodução"],
  ["Interface", "Oberfläche", "Interfaz", "Interface", "Interfaccia", "Interface"],
  ["Appearance", "Darstellung", "Apariencia", "Apparence", "Aspetto", "Aparência"],
  ["Theme", "Design", "Tema", "Thème", "Tema", "Tema"],
  ["Notifications", "Benachrichtigungen", "Notificaciones", "Notifications", "Notifiche", "Notificações"],
  ["Storage & Data", "Speicher & Daten", "Almacenamiento y datos", "Stockage et données", "Archiviazione e dati", "Armazenamento e dados"],
  ["Backup & Restore", "Sichern & Wiederherstellen", "Copia de seguridad", "Sauvegarde et restauration", "Backup e ripristino", "Backup e restauração"],
  ["Library & Privacy", "Mediathek & Privatsphäre", "Biblioteca y privacidad", "Bibliothèque et confidentialité", "Libreria e privacy", "Biblioteca e privacidade"],
  ["Profiles", "Profile", "Perfiles", "Profils", "Profili", "Perfis"],
  ["Profiles & Privacy", "Profile & Privatsphäre", "Perfiles y privacidad", "Profils et confidentialité", "Profili e privacy", "Perfis e privacidade"],
  ["Cloud sync", "Cloud-Sync", "Sincronización en la nube", "Synchronisation cloud", "Sincronizzazione cloud", "Sincronização na nuvem"],
  ["Sync now", "Jetzt synchronisieren", "Sincronizar ahora", "Synchroniser", "Sincronizza ora", "Sincronizar agora"],
  ["Sync automatically", "Automatisch synchronisieren", "Sincronizar automáticamente", "Synchroniser automatiquement", "Sincronizza automaticamente", "Sincronizar automaticamente"],
  ["Disconnect", "Trennen", "Desconectar", "Déconnecter", "Disconnetti", "Desconectar"],
  ["App lock", "App-Sperre", "Bloqueo de la app", "Verrouillage", "Blocco app", "Bloqueio do app"],
  ["Lock Streambert", "Streambert sperren", "Bloquear Streambert", "Verrouiller Streambert", "Blocca Streambert", "Bloquear o Streambert"],
  ["Immediately", "Sofort", "Inmediatamente", "Immédiatement", "Subito", "Imediatamente"],
  ["After 1 minute", "Nach 1 Minute", "Tras 1 minuto", "Après 1 minute", "Dopo 1 minuto", "Após 1 minuto"],
  ["After 5 minutes", "Nach 5 Minuten", "Tras 5 minutos", "Après 5 minutes", "Dopo 5 minuti", "Após 5 minutos"],
  ["After 15 minutes", "Nach 15 Minuten", "Tras 15 minutos", "Après 15 minutes", "Dopo 15 minuti", "Após 15 minutos"],
  ["Ask who's watching", "Fragen, wer schaut", "Preguntar quién ve", "Demander qui regarde", "Chiedi chi guarda", "Perguntar quem está assistindo"],
  ["Home-screen widget", "Startbildschirm-Widget", "Widget de inicio", "Widget d'écran d'accueil", "Widget della schermata Home", "Widget da tela inicial"],
  ["Add widget to home screen", "Widget zum Startbildschirm hinzufügen", "Añadir widget al inicio", "Ajouter le widget", "Aggiungi widget alla Home", "Adicionar widget à tela inicial"],
  ["Save downloads to", "Downloads speichern in", "Guardar descargas en", "Enregistrer les téléchargements dans", "Salva i download in", "Salvar downloads em"],
  ["App storage", "App-Speicher", "Almacenamiento de la app", "Stockage de l'app", "Memoria dell'app", "Armazenamento do app"],
  ["Movies folder", "Filme-Ordner", "Carpeta Películas", "Dossier Films", "Cartella Film", "Pasta Filmes"],
  ["Choose folder…", "Ordner wählen …", "Elegir carpeta…", "Choisir un dossier…", "Scegli cartella…", "Escolher pasta…"],
  ["Download options", "Download-Optionen", "Opciones de descarga", "Options de téléchargement", "Opzioni di download", "Opções de download"],
  ["Download on Wi-Fi only", "Nur über WLAN herunterladen", "Descargar solo con Wi-Fi", "Télécharger en Wi-Fi uniquement", "Scarica solo con Wi-Fi", "Baixar só no Wi-Fi"],
  ["Save as MP4", "Als MP4 speichern", "Guardar como MP4", "Enregistrer en MP4", "Salva come MP4", "Salvar como MP4"],
  ["Smart downloads", "Intelligente Downloads", "Descargas inteligentes", "Téléchargements intelligents", "Download intelligenti", "Downloads inteligentes"],
  ["Storage limit", "Speicherlimit", "Límite de almacenamiento", "Limite de stockage", "Limite di spazio", "Limite de armazenamento"],
  ["Next 1", "Nächste 1", "Siguiente 1", "Suivant 1", "Prossimo 1", "Próximo 1"],
  ["Next 2", "Nächste 2", "Siguientes 2", "2 suivants", "Prossimi 2", "Próximos 2"],
  ["Next 3", "Nächste 3", "Siguientes 3", "3 suivants", "Prossimi 3", "Próximos 3"],
  ["No limit", "Kein Limit", "Sin límite", "Sans limite", "Nessun limite", "Sem limite"],
  ["When you finish an episode, download the next ones of that show automatically. Only on Wi-Fi, using the source you watch with.", "Wenn du eine Folge zu Ende schaust, werden die nächsten automatisch heruntergeladen. Nur über WLAN, mit der Quelle, mit der du schaust.", "Al terminar un episodio, se descargan automáticamente los siguientes de esa serie. Solo con Wi-Fi y con la fuente que usas.", "Quand vous finissez un épisode, les suivants de la série sont téléchargés automatiquement. En Wi-Fi uniquement, avec la source que vous utilisez.", "Quando finisci un episodio, i successivi della serie vengono scaricati in automatico. Solo con Wi-Fi, con la fonte che usi.", "Ao terminar um episódio, os próximos da série são baixados automaticamente. Só no Wi-Fi, com a fonte que você usa."],
  ["Downloads wait (and continue automatically) when you're on mobile data.", "Downloads warten bei mobilen Daten und laufen dann automatisch weiter.", "Las descargas esperan (y siguen solas) cuando usas datos móviles.", "Les téléchargements attendent (et reprennent seuls) sur les données mobiles.", "Con i dati mobili i download aspettano (e riprendono da soli).", "Os downloads esperam (e continuam sozinhos) quando você está nos dados móveis."],
  ["Private to Streambert. Removed if you uninstall the app.", "Nur für Streambert. Wird beim Deinstallieren gelöscht.", "Privado para Streambert. Se borra al desinstalar la app.", "Réservé à Streambert. Supprimé si vous désinstallez l'app.", "Privato per Streambert. Viene eliminato disinstallando l'app.", "Privado do Streambert. Removido se você desinstalar o app."],
  ["Any folder, including an SD card.", "Jeder Ordner, auch auf einer SD-Karte.", "Cualquier carpeta, incluso en una tarjeta SD.", "N'importe quel dossier, carte SD comprise.", "Qualsiasi cartella, anche su scheda SD.", "Qualquer pasta, inclusive no cartão SD."],
  ["Language of Streambert's menus and buttons. Movie and show info uses the metadata language below.", "Sprache der Menüs und Schaltflächen. Infos zu Filmen und Serien nutzen die Inhaltssprache darunter.", "Idioma de los menús y botones. La información de películas y series usa el idioma de los datos de abajo.", "Langue des menus et des boutons. Les fiches des films et séries utilisent la langue des fiches ci-dessous.", "Lingua di menu e pulsanti. Le informazioni su film e serie usano la lingua dei contenuti qui sotto.", "Idioma dos menus e botões. As informações de filmes e séries usam o idioma dos dados abaixo."],
  ["Auto-download", "Auto-Download", "Descarga automática", "Téléchargement auto", "Download automatico", "Download automático"],
  ["Profiles & Sync", "Profile & Sync", "Perfiles y sincronización", "Profils et synchronisation", "Profili e sincronizzazione", "Perfis e sincronização"],
  ["Downloaded videos", "Heruntergeladene Videos", "Vídeos descargados", "Vidéos téléchargées", "Video scaricati", "Vídeos baixados"],
  ["Play downloads in Streambert", "Downloads in Streambert abspielen", "Reproducir descargas en Streambert", "Lire les téléchargements dans Streambert", "Riproduci i download in Streambert", "Reproduzir downloads no Streambert"],
  ["Download Folder", "Download-Ordner", "Carpeta de descargas", "Dossier de téléchargement", "Cartella download", "Pasta de downloads"],
  ["Set Download Folder", "Download-Ordner festlegen", "Elegir carpeta de descargas", "Choisir le dossier", "Imposta cartella download", "Definir pasta de downloads"],
  ["Browse", "Durchsuchen", "Examinar", "Parcourir", "Sfoglia", "Procurar"],
  ["Browse…", "Durchsuchen …", "Examinar…", "Parcourir…", "Sfoglia…", "Procurar…"],
  ["Quit App", "Beenden", "Salir", "Quitter", "Esci", "Sair"],
  ["Minimize", "Minimieren", "Minimizar", "Réduire", "Riduci a icona", "Minimizar"],
  ["Help & Shortcuts (?)", "Hilfe & Tastenkürzel (?)", "Ayuda y atajos (?)", "Aide et raccourcis (?)", "Aiuto e scorciatoie (?)", "Ajuda e atalhos (?)"],
  ["KEYBOARD SHORTCUTS", "TASTENKÜRZEL", "ATAJOS DE TECLADO", "RACCOURCIS CLAVIER", "SCORCIATOIE DA TASTIERA", "ATALHOS DE TECLADO"],
  ["Desktop Notifications", "Desktop-Benachrichtigungen", "Notificaciones de escritorio", "Notifications du bureau", "Notifiche desktop", "Notificações da área de trabalho"],
  ["Discord Rich Presence", "Discord Rich Presence", "Discord Rich Presence", "Discord Rich Presence", "Discord Rich Presence", "Discord Rich Presence"],
  ["Play this stream in mpv or VLC", "Diesen Stream in mpv oder VLC abspielen", "Reproducir en mpv o VLC", "Lire ce flux dans mpv ou VLC", "Riproduci in mpv o VLC", "Reproduzir no mpv ou VLC"],
  ["Subtitle style & timing", "Untertitel-Stil & Timing", "Estilo y sincronía de subtítulos", "Style et synchro des sous-titres", "Stile e sincronia sottotitoli", "Estilo e sincronia das legendas"],
  ["Pop out player", "Player abdocken", "Separar reproductor", "Détacher le lecteur", "Stacca il player", "Destacar player"],
  ["App lock", "App-Sperre", "Bloqueo de la app", "Verrouillage", "Blocco app", "Bloqueio do app"],
  ["Enter your PIN", "PIN eingeben", "Introduce tu PIN", "Saisissez votre code", "Inserisci il PIN", "Digite seu PIN"],
  ["Wrong PIN", "Falsche PIN", "PIN incorrecto", "Code incorrect", "PIN errato", "PIN incorreto"],
  ["Unlock", "Entsperren", "Desbloquear", "Déverrouiller", "Sblocca", "Desbloquear"],
  ["Discover", "Entdecken", "Descubrir", "Découvrir", "Scopri", "Descobrir"],
  ["Collections, genres and filters", "Sammlungen, Genres und Filter", "Colecciones, géneros y filtros", "Collections, genres et filtres", "Raccolte, generi e filtri", "Coleções, gêneros e filtros"],
  ["New this month", "Neu diesen Monat", "Nuevo este mes", "Nouveau ce mois-ci", "Novità del mese", "Novos este mês"],
  ["Coming soon", "Bald im Kino", "Próximos estrenos", "Bientôt", "Prossimamente", "Em breve nos cinemas"],
  ["Top horror", "Top-Horror", "Lo mejor del terror", "Le meilleur de l'horreur", "Il meglio dell'horror", "Melhores de terror"],
  ["80s action", "Action der 80er", "Acción de los 80", "Action des années 80", "Azione anni '80", "Ação dos anos 80"],
  ["Feel-good comedies", "Gute-Laune-Komödien", "Comedias para sonreír", "Comédies feel-good", "Commedie per star bene", "Comédias para animar"],
  ["Mind-bending sci-fi", "Sci-Fi zum Nachdenken", "Ciencia ficción alucinante", "SF qui retourne le cerveau", "Fantascienza da capogiro", "Ficção científica alucinante"],
  ["Animated for everyone", "Animation für alle", "Animación para todos", "Animation pour tous", "Animazione per tutti", "Animação para todos"],
  ["Hidden gems", "Geheimtipps", "Joyas ocultas", "Pépites méconnues", "Gemme nascoste", "Joias escondidas"],
  ["Korean dramas", "Koreanische Dramen", "Dramas coreanos", "Dramas coréens", "Drama coreani", "Doramas coreanos"],
  ["Anime series", "Anime-Serien", "Series de anime", "Séries animées japonaises", "Serie anime", "Séries de anime"],
  ["True crime documentaries", "True-Crime-Dokus", "Documentales de crímenes reales", "Documentaires true crime", "Documentari true crime", "Documentários de crimes reais"],
  ["Bingeable series", "Serien zum Durchschauen", "Series para maratonear", "Séries à dévorer", "Serie da maratona", "Séries para maratonar"],
  ["Movies", "Filme", "Películas", "Films", "Film", "Filmes"],
  ["Filters", "Filter", "Filtros", "Filtres", "Filtri", "Filtros"],
  ["Year", "Jahr", "Año", "Année", "Anno", "Ano"],
  ["Rating", "Bewertung", "Valoración", "Note", "Voto", "Nota"],
  ["Length", "Länge", "Duración", "Durée", "Durata", "Duração"],
  ["Original language", "Originalsprache", "Idioma original", "Langue d'origine", "Lingua originale", "Idioma original"],
  ["Any year", "Jedes Jahr", "Cualquier año", "Toutes années", "Qualsiasi anno", "Qualquer ano"],
  ["Any rating", "Jede Bewertung", "Cualquier nota", "Toutes notes", "Qualsiasi voto", "Qualquer nota"],
  ["Any length", "Jede Länge", "Cualquier duración", "Toutes durées", "Qualsiasi durata", "Qualquer duração"],
  ["Any language", "Jede Sprache", "Cualquier idioma", "Toutes langues", "Qualsiasi lingua", "Qualquer idioma"],
  ["Under 90 min", "Unter 90 Min.", "Menos de 90 min", "Moins de 90 min", "Meno di 90 min", "Menos de 90 min"],
  ["Over 2 h", "Über 2 Std.", "Más de 2 h", "Plus de 2 h", "Oltre 2 h", "Mais de 2 h"],
  ["Older", "Älter", "Anteriores", "Plus ancien", "Più vecchi", "Mais antigos"],
  ["Popular", "Beliebt", "Populares", "Populaires", "Popolari", "Populares"],
  ["Newest", "Neueste", "Más recientes", "Plus récents", "Più recenti", "Mais recentes"],
  ["Load more", "Mehr laden", "Cargar más", "Charger plus", "Carica altri", "Carregar mais"],
  ["Reset filters", "Filter zurücksetzen", "Restablecer filtros", "Réinitialiser les filtres", "Reimposta filtri", "Limpar filtros"],
  ["✕ Clear", "✕ Zurücksetzen", "✕ Quitar", "✕ Effacer", "✕ Rimuovi", "✕ Limpar"],
  ["Nothing matches these filters. Try fewer filters.", "Nichts passt zu diesen Filtern. Versuche weniger Filter.", "Nada coincide con estos filtros. Prueba con menos.", "Aucun résultat avec ces filtres. Essayez-en moins.", "Nessun risultato con questi filtri. Provane meno.", "Nada corresponde a esses filtros. Tente menos filtros."],
  ["Action", "Action", "Acción", "Action", "Azione", "Ação"],
  ["Adventure", "Abenteuer", "Aventura", "Aventure", "Avventura", "Aventura"],
  ["Animation", "Animation", "Animación", "Animation", "Animazione", "Animação"],
  ["Comedy", "Komödie", "Comedia", "Comédie", "Commedia", "Comédia"],
  ["Crime", "Krimi", "Crimen", "Policier", "Crimine", "Crime"],
  ["Documentary", "Doku", "Documental", "Documentaire", "Documentario", "Documentário"],
  ["Drama", "Drama", "Drama", "Drame", "Drammatico", "Drama"],
  ["Family", "Familie", "Familia", "Famille", "Famiglia", "Família"],
  ["Fantasy", "Fantasy", "Fantasía", "Fantastique", "Fantasy", "Fantasia"],
  ["Horror", "Horror", "Terror", "Horreur", "Horror", "Terror"],
  ["Mystery", "Mystery", "Misterio", "Mystère", "Mistero", "Mistério"],
  ["Romance", "Romantik", "Romance", "Romance", "Romantico", "Romance"],
  ["Sci-Fi", "Sci-Fi", "Ciencia ficción", "SF", "Fantascienza", "Ficção científica"],
  ["Thriller", "Thriller", "Suspense", "Thriller", "Thriller", "Suspense"],
  ["War", "Krieg", "Bélica", "Guerre", "Guerra", "Guerra"],
  ["Western", "Western", "Wéstern", "Western", "Western", "Faroeste"],
  ["English", "Englisch", "Inglés", "Anglais", "Inglese", "Inglês"],
  ["German", "Deutsch", "Alemán", "Allemand", "Tedesco", "Alemão"],
  ["Spanish", "Spanisch", "Español", "Espagnol", "Spagnolo", "Espanhol"],
  ["French", "Französisch", "Francés", "Français", "Francese", "Francês"],
  ["Italian", "Italienisch", "Italiano", "Italien", "Italiano", "Italiano"],
  ["Portuguese", "Portugiesisch", "Portugués", "Portugais", "Portoghese", "Português"],
  ["Japanese", "Japanisch", "Japonés", "Japonais", "Giapponese", "Japonês"],
  ["Korean", "Koreanisch", "Coreano", "Coréen", "Coreano", "Coreano"],
  ["Chinese", "Chinesisch", "Chino", "Chinois", "Cinese", "Chinês"],
  ["Turkish", "Türkisch", "Turco", "Turc", "Turco", "Turco"],
  ["Swedish", "Schwedisch", "Sueco", "Suédois", "Svedese", "Sueco"],
  ["+ Follow", "+ Folgen", "+ Seguir", "+ Suivre", "+ Segui", "+ Seguir"],
  ["✓ Following", "✓ Folge ich", "✓ Siguiendo", "✓ Suivi", "✓ Segui già", "✓ Seguindo"],
  ["Read more", "Mehr lesen", "Leer más", "Lire la suite", "Leggi tutto", "Ler mais"],
  ["Show less", "Weniger", "Mostrar menos", "Réduire", "Mostra meno", "Mostrar menos"],
  ["Acting", "Schauspiel", "Actuación", "Acteur", "Recitazione", "Atuação"],
  ["Directing", "Regie", "Dirección", "Réalisation", "Regia", "Direção"],
  ["Writing", "Drehbuch", "Guion", "Scénario", "Sceneggiatura", "Roteiro"],
  ["Production", "Produktion", "Producción", "Production", "Produzione", "Produção"],
  ["Sound", "Ton", "Sonido", "Son", "Suono", "Som"],
  ["Camera", "Kamera", "Cámara", "Image", "Fotografia", "Câmera"],
  ["Editing", "Schnitt", "Montaje", "Montage", "Montaggio", "Edição"],
  ["Crew", "Crew", "Equipo", "Équipe", "Troupe", "Equipe"],
  ["Art", "Ausstattung", "Arte", "Décors", "Scenografia", "Arte"],
  ["Creator", "Idee", "Creación", "Création", "Ideazione", "Criação"],
  ["All", "Alle", "Todo", "Tout", "Tutto", "Tudo"],
  ["Nothing here.", "Hier ist nichts.", "No hay nada.", "Rien ici.", "Niente qui.", "Nada aqui."],
  ["New from people you follow", "Neu von Leuten, denen du folgst", "Novedades de quienes sigues", "Nouveautés des personnes suivies", "Novità di chi segui", "Novidades de quem você segue"],
  ["Episode reminders", "Folgen-Erinnerungen", "Recordatorios de episodios", "Rappels d'épisodes", "Promemoria episodi", "Lembretes de episódios"],
  ["Remind me on release day", "Am Erscheinungstag erinnern", "Avisarme el día del estreno", "Me prévenir le jour de sortie", "Avvisami il giorno d'uscita", "Lembrar no dia do lançamento"],
  ["Remind me at", "Erinnern um", "Avisarme a las", "Me prévenir à", "Avvisami alle", "Lembrar às"],
  ["People you follow", "Leute, denen du folgst", "Personas que sigues", "Personnes suivies", "Persone che segui", "Pessoas que você segue"],
  ["Unfollow", "Nicht mehr folgen", "Dejar de seguir", "Ne plus suivre", "Non seguire più", "Deixar de seguir"],
  ["Parent PIN", "Eltern-PIN", "PIN parental", "Code parental", "PIN genitori", "PIN dos pais"],
  ["Use phone screen lock", "Displaysperre des Telefons nutzen", "Usar el bloqueo del teléfono", "Utiliser le verrouillage du téléphone", "Usa il blocco del telefono", "Usar o bloqueio do telefone"],
  ["Leaving a kids profile needs the parent PIN.", "Zum Verlassen eines Kinderprofils wird die Eltern-PIN benötigt.", "Para salir de un perfil infantil se necesita el PIN parental.", "Quitter un profil enfant demande le code parental.", "Per uscire da un profilo bambini serve il PIN genitori.", "Para sair de um perfil infantil é preciso o PIN dos pais."],
  ["Managing profiles needs the parent PIN.", "Zum Verwalten der Profile wird die Eltern-PIN benötigt.", "Para gestionar perfiles se necesita el PIN parental.", "Gérer les profils demande le code parental.", "Per gestire i profili serve il PIN genitori.", "Para gerenciar perfis é preciso o PIN dos pais."],
  ["Settings are locked in a kids profile.", "Einstellungen sind im Kinderprofil gesperrt.", "Los ajustes están bloqueados en un perfil infantil.", "Les paramètres sont verrouillés dans un profil enfant.", "Le impostazioni sono bloccate nel profilo bambini.", "As configurações ficam bloqueadas no perfil infantil."],
  ["Kids profile", "Kinderprofil", "Perfil infantil", "Profil enfant", "Profilo bambini", "Perfil infantil"],
  ["Age limit", "Altersgrenze", "Edad máxima", "Limite d'âge", "Limite di età", "Limite de idade"],
  ["Only titles up to its age limit. Leaving it or opening Settings needs the parent PIN.", "Nur Titel bis zur Altersgrenze. Zum Verlassen oder für die Einstellungen wird die Eltern-PIN benötigt.", "Solo títulos hasta su edad máxima. Salir o abrir los ajustes pide el PIN parental.", "Uniquement les titres jusqu'à sa limite d'âge. Le quitter ou ouvrir les paramètres demande le code parental.", "Solo titoli entro il limite di età. Per uscire o aprire le impostazioni serve il PIN genitori.", "Só títulos até o limite de idade. Sair ou abrir as configurações pede o PIN dos pais."],
  ["Set a parent PIN (asked to leave the kids profile)", "Eltern-PIN festlegen (zum Verlassen des Kinderprofils)", "Elige un PIN parental (para salir del perfil infantil)", "Choisissez un code parental (pour quitter le profil enfant)", "Imposta un PIN genitori (per uscire dal profilo bambini)", "Defina um PIN dos pais (para sair do perfil infantil)"],
  ["Choose a parent PIN of 4 to 12 digits.", "Wähle eine Eltern-PIN mit 4 bis 12 Ziffern.", "Elige un PIN de 4 a 12 cifras.", "Choisissez un code de 4 à 12 chiffres.", "Scegli un PIN di 4–12 cifre.", "Escolha um PIN de 4 a 12 dígitos."],
  ["The two PINs don't match.", "Die beiden PINs stimmen nicht überein.", "Los dos PIN no coinciden.", "Les deux codes ne correspondent pas.", "I due PIN non coincidono.", "Os dois PINs não coincidem."],
  ["Quality", "Qualität", "Calidad", "Qualité", "Qualità", "Qualidade"],
  ["Best", "Beste", "Mejor", "Meilleure", "Migliore", "Melhor"],
  ["Download quality", "Download-Qualität", "Calidad de descarga", "Qualité de téléchargement", "Qualità download", "Qualidade do download"],
  ["The quality new downloads use (you can still pick another one per download). Lower quality saves space.", "Die Qualität für neue Downloads (pro Download änderbar). Niedrigere Qualität spart Platz.", "La calidad de las descargas nuevas (se puede cambiar en cada una). Menos calidad ocupa menos espacio.", "La qualité des nouveaux téléchargements (modifiable à chaque fois). Une qualité plus basse prend moins de place.", "La qualità dei nuovi download (modificabile per ciascuno). Una qualità più bassa occupa meno spazio.", "A qualidade dos novos downloads (dá para mudar em cada um). Menor qualidade ocupa menos espaço."],
  ["Share", "Teilen", "Compartir", "Partager", "Condividi", "Compartilhar"],
  ["Save image", "Bild speichern", "Guardar imagen", "Enregistrer l'image", "Salva immagine", "Salvar imagem"],
  ["Trakt", "Trakt", "Trakt", "Trakt", "Trakt", "Trakt"],
  ["Connect Trakt", "Trakt verbinden", "Conectar Trakt", "Connecter Trakt", "Collega Trakt", "Conectar Trakt"],
  ["Connecting…", "Verbinde …", "Conectando…", "Connexion…", "Connessione…", "Conectando…"],
  ["Import from Trakt", "Von Trakt importieren", "Importar de Trakt", "Importer depuis Trakt", "Importa da Trakt", "Importar do Trakt"],
  ["Importing…", "Importiere …", "Importando…", "Importation…", "Importazione…", "Importando…"],
  ["Show what I'm watching on Trakt", "Auf Trakt zeigen, was ich schaue", "Mostrar en Trakt lo que veo", "Afficher sur Trakt ce que je regarde", "Mostra su Trakt cosa guardo", "Mostrar no Trakt o que estou vendo"],
  ["Add what I finish to my Trakt history", "Fertig Geschautes zum Trakt-Verlauf hinzufügen", "Añadir lo que termino a mi historial de Trakt", "Ajouter ce que je termine à mon historique Trakt", "Aggiungi ciò che finisco alla cronologia Trakt", "Adicionar o que termino ao histórico do Trakt"],
  ["Send my ratings to Trakt", "Meine Bewertungen an Trakt senden", "Enviar mis valoraciones a Trakt", "Envoyer mes notes à Trakt", "Invia i miei voti a Trakt", "Enviar minhas avaliações ao Trakt"],
  ["Waiting for you to approve it on Trakt…", "Warte auf deine Bestätigung bei Trakt …", "Esperando a que lo apruebes en Trakt…", "En attente de votre validation sur Trakt…", "In attesa della tua conferma su Trakt…", "Aguardando sua aprovação no Trakt…"],
  ["and enter this code:", "und gib diesen Code ein:", "e introduce este código:", "et saisissez ce code :", "e inserisci questo codice:", "e digite este código:"],
  ["Go to", "Öffne", "Ve a", "Allez sur", "Vai su", "Acesse"],
  ["Connected as", "Verbunden als", "Conectado como", "Connecté en tant que", "Collegato come", "Conectado como"],
  ["Watch party", "Watchparty", "Ver juntos", "Watch party", "Guarda insieme", "Assistir juntos"],
  ["Start a party", "Party starten", "Crear sala", "Lancer une soirée", "Avvia una party", "Criar sala"],
  ["Starting…", "Starte …", "Creando…", "Lancement…", "Avvio…", "Criando…"],
  ["or join one", "oder einer beitreten", "o únete a una", "ou rejoignez-en une", "o unisciti a una", "ou entre em uma"],
  ["Party code", "Party-Code", "Código de la sala", "Code de la soirée", "Codice party", "Código da sala"],
  ["Join", "Beitreten", "Unirse", "Rejoindre", "Unisciti", "Entrar"],
  ["Your name", "Dein Name", "Tu nombre", "Votre nom", "Il tuo nome", "Seu nome"],
  ["Copy", "Kopieren", "Copiar", "Copier", "Copia", "Copiar"],
  ["✓ Copied", "✓ Kopiert", "✓ Copiado", "✓ Copié", "✓ Copiato", "✓ Copiado"],
  ["Leave", "Verlassen", "Salir", "Quitter", "Esci", "Sair"],
  ["Send", "Senden", "Enviar", "Envoyer", "Invia", "Enviar"],
  ["Message", "Nachricht", "Mensaje", "Message", "Messaggio", "Mensagem"],
  ["Open it", "Öffnen", "Abrir", "Ouvrir", "Apri", "Abrir"],
  ["is watching", "schaut", "está viendo", "regarde", "sta guardando", "está assistindo"],
  ["Reconnecting…", "Verbinde neu …", "Reconectando…", "Reconnexion…", "Riconnessione…", "Reconectando…"],
  ["Send the code to a friend so they can join.", "Schick den Code einem Freund, damit er beitreten kann.", "Envía el código a un amigo para que se una.", "Envoyez le code à un ami pour qu'il vous rejoigne.", "Manda il codice a un amico per farlo entrare.", "Envie o código para um amigo entrar."],
  ["Watch together: play, pause and jumping stay in sync, and you can chat. Everyone needs Streambert and the same source. Messages are end-to-end encrypted with the party code.", "Gemeinsam schauen: Abspielen, Pausieren und Springen bleiben synchron, und ihr könnt chatten. Alle brauchen Streambert und dieselbe Quelle. Nachrichten sind mit dem Party-Code Ende-zu-Ende-verschlüsselt.", "Ved juntos: reproducir, pausar y saltar se sincronizan, y podéis chatear. Todos necesitan Streambert y la misma fuente. Los mensajes van cifrados de extremo a extremo con el código.", "Regardez ensemble : lecture, pause et sauts restent synchronisés, et vous pouvez discuter. Tout le monde a besoin de Streambert et de la même source. Les messages sont chiffrés de bout en bout avec le code.", "Guardate insieme: play, pausa e salti restano sincronizzati e potete chattare. Tutti devono avere Streambert e la stessa fonte. I messaggi sono cifrati end-to-end con il codice.", "Assistam juntos: play, pausa e pulos ficam sincronizados, e vocês podem conversar. Todos precisam do Streambert e da mesma fonte. As mensagens são criptografadas de ponta a ponta com o código."],
  ["👑 You're the host", "👑 Du bist der Host", "👑 Eres el anfitrión", "👑 Vous êtes l'hôte", "👑 Sei l'host", "👑 Você é o anfitrião"],
  ["Hosted by", "Host:", "Anfitrión:", "Hôte :", "Host:", "Anfitrião:"],
  ["Host", "Host", "Anfitrión", "Hôte", "Host", "Anfitrião"],
  ["joined the party", "ist der Party beigetreten", "se unió", "a rejoint la soirée", "si è unito", "entrou na sala"],
  ["Everyone can control playback", "Alle dürfen steuern", "Todos pueden controlar", "Tout le monde peut contrôler", "Tutti possono controllare", "Todos podem controlar"],
  ["Only the host controls playback", "Nur der Host steuert die Wiedergabe", "Solo el anfitrión controla la reproducción", "Seul l'hôte contrôle la lecture", "Solo l'host controlla la riproduzione", "Só o anfitrião controla a reprodução"],
  ["Ready check", "Bereitschaftscheck", "¿Todos listos?", "Tout le monde est prêt ?", "Tutti pronti?", "Todos prontos?"],
  ["Ready check: are you ready?", "Bereitschaftscheck: Bist du bereit?", "¿Estás listo?", "Vous êtes prêt ?", "Sei pronto?", "Você está pronto?"],
  ["I'm ready", "Ich bin bereit", "Estoy listo", "Je suis prêt", "Sono pronto", "Estou pronto"],
  ["✓ You're ready. Waiting for the others…", "✓ Du bist bereit. Warte auf die anderen…", "✓ Listo. Esperando a los demás…", "✓ Prêt. En attente des autres…", "✓ Pronto. In attesa degli altri…", "✓ Pronto. Esperando os outros…"],
  ["Start now", "Jetzt starten", "Empezar ya", "Démarrer", "Inizia ora", "Começar agora"],
  ["Invite", "Einladen", "Invitar", "Inviter", "Invita", "Convidar"],
  ["✓ Link copied", "✓ Link kopiert", "✓ Enlace copiado", "✓ Lien copié", "✓ Link copiato", "✓ Link copiado"],
  ["Queue", "Warteschlange", "Cola", "File d'attente", "Coda", "Fila"],
  ["Chat", "Chat", "Chat", "Chat", "Chat", "Chat"],
  ["＋ Party queue", "＋ Party-Warteschlange", "＋ Cola de la fiesta", "＋ File de la soirée", "＋ Coda del party", "＋ Fila da sala"],
  ["＋ Suggest", "＋ Vorschlagen", "＋ Sugerir", "＋ Suggérer", "＋ Suggerisci", "＋ Sugerir"],
  ["＋ Add", "＋ Hinzufügen", "＋ Añadir", "＋ Ajouter", "＋ Aggiungi", "＋ Adicionar"],
  ["✓ Added", "✓ Hinzugefügt", "✓ Añadido", "✓ Ajouté", "✓ Aggiunto", "✓ Adicionado"],
  ["added by", "von", "añadido por", "ajouté par", "aggiunto da", "adicionado por"],
  ["Nothing queued yet. Add titles from their page, and suggestions from the others show up here.", "Noch nichts in der Warteschlange. Füge Titel auf ihrer Seite hinzu, Vorschläge der anderen erscheinen hier.", "La cola está vacía. Añade títulos desde su página; las sugerencias de los demás aparecen aquí.", "Rien en attente. Ajoutez des titres depuis leur page ; les suggestions des autres apparaissent ici.", "Coda vuota. Aggiungi titoli dalla loro pagina; i suggerimenti degli altri appaiono qui.", "Fila vazia. Adicione títulos pela página deles; as sugestões dos outros aparecem aqui."],
  ["Nothing queued yet. Suggest a title from its page and the host can play it for everyone.", "Noch nichts in der Warteschlange. Schlag einen Titel auf seiner Seite vor, der Host kann ihn für alle abspielen.", "La cola está vacía. Sugiere un título desde su página y el anfitrión podrá ponerlo para todos.", "Rien en attente. Suggérez un titre depuis sa page et l'hôte pourra le lancer pour tous.", "Coda vuota. Suggerisci un titolo dalla sua pagina e l'host potrà avviarlo per tutti.", "Fila vazia. Sugira um título pela página dele e o anfitrião pode tocar para todos."],
  ["Send the invite to a friend so they can join.", "Schick die Einladung an Freunde, damit sie beitreten können.", "Envía la invitación a un amigo para que se una.", "Envoyez l'invitation à un ami pour qu'il rejoigne.", "Invia l'invito a un amico per farlo entrare.", "Envie o convite a um amigo para ele entrar."],
  ["ready", "bereit", "listos", "prêts", "pronti", "prontos"],
  ["Joining…", "Trete bei…", "Uniéndose…", "Connexion…", "Accesso…", "Entrando…"],
  ["App language", "App-Sprache", "Idioma de la app", "Langue de l'app", "Lingua dell'app", "Idioma do app"],
  ["Phone language", "Sprache des Telefons", "Idioma del teléfono", "Langue du téléphone", "Lingua del telefono", "Idioma do telefone"],
  ["System language", "Systemsprache", "Idioma del sistema", "Langue du système", "Lingua di sistema", "Idioma do sistema"],
  ["Metadata Language", "Sprache der Inhalte", "Idioma de los datos", "Langue des fiches", "Lingua dei contenuti", "Idioma dos dados"],
  ["Start Page", "Startseite", "Página de inicio", "Page de démarrage", "Pagina iniziale", "Página inicial"],
  ["Home Page Layout", "Startseiten-Aufbau", "Diseño de inicio", "Mise en page de l'accueil", "Layout della Home", "Layout do início"],
  ["Save Layout", "Aufbau speichern", "Guardar diseño", "Enregistrer la mise en page", "Salva layout", "Salvar layout"],
  ["Reset to defaults", "Standard wiederherstellen", "Restablecer valores", "Valeurs par défaut", "Ripristina predefiniti", "Restaurar padrões"],
  ["Watchlist sort order", "Sortierung der Merkliste", "Orden de la lista", "Tri de la liste", "Ordine della lista", "Ordem da lista"],
  ["Record watch history", "Verlauf speichern", "Guardar historial", "Enregistrer l'historique", "Salva cronologia", "Salvar histórico"],
  ["Autoplay Next Episode", "Nächste Folge automatisch abspielen", "Reproducir siguiente episodio", "Lecture auto de l'épisode suivant", "Riproduci episodio successivo", "Reproduzir próximo episódio"],
  ["Enable Autoplay Next", "Autoplay aktivieren", "Activar reproducción automática", "Activer la lecture auto", "Attiva riproduzione automatica", "Ativar reprodução automática"],
  ["Countdown Duration", "Countdown-Dauer", "Duración de la cuenta atrás", "Durée du compte à rebours", "Durata del conto alla rovescia", "Duração da contagem"],
  ["Anime Intro Skip", "Anime-Intro überspringen", "Saltar intro de anime", "Passer l'intro des animés", "Salta intro anime", "Pular abertura de anime"],
  ["Auto Skip", "Automatisch überspringen", "Saltar automáticamente", "Passer automatiquement", "Salta automaticamente", "Pular automaticamente"],
  ["Manual Skip", "Manuell überspringen", "Saltar manualmente", "Passer manuellement", "Salta manualmente", "Pular manualmente"],
  ["Skip", "Überspringen", "Saltar", "Passer", "Salta", "Pular"],
  ["Auto-Watched Threshold", "Ab wann als gesehen gilt", "Umbral de visto", "Seuil « vu »", "Soglia di visto", "Limite para assistido"],
  ["Maximum Allowed Age Rating", "Höchste erlaubte Altersfreigabe", "Clasificación máxima permitida", "Classification maximale autorisée", "Classificazione massima consentita", "Classificação máxima permitida"],
  ["No restriction", "Keine Einschränkung", "Sin restricción", "Aucune restriction", "Nessuna restrizione", "Sem restrição"],
  ["Rating Country", "Land der Altersfreigabe", "País de clasificación", "Pays de classification", "Paese di classificazione", "País da classificação"],
  ["Age Rating", "Altersfreigabe", "Clasificación por edad", "Classification", "Classificazione", "Classificação"],
  ["Reduce animations", "Animationen reduzieren", "Reducir animaciones", "Réduire les animations", "Riduci animazioni", "Reduzir animações"],
  ["Accent Colour", "Akzentfarbe", "Color de acento", "Couleur d'accent", "Colore principale", "Cor de destaque"],
  ["Font Size", "Schriftgröße", "Tamaño de letra", "Taille du texte", "Dimensione testo", "Tamanho da fonte"],
  ["Normal", "Normal", "Normal", "Normal", "Normale", "Normal"],
  ["Carousel", "Karussell", "Carrusel", "Carrousel", "Carosello", "Carrossel"],
  ["Row display style", "Darstellung der Reihen", "Estilo de las filas", "Style des rangées", "Stile delle righe", "Estilo das linhas"],
  ["App Version", "App-Version", "Versión de la app", "Version de l'app", "Versione app", "Versão do app"],
  ["Current version", "Aktuelle Version", "Versión actual", "Version actuelle", "Versione attuale", "Versão atual"],
  ["Check for updates on startup", "Beim Start nach Updates suchen", "Buscar actualizaciones al iniciar", "Vérifier les mises à jour au démarrage", "Cerca aggiornamenti all'avvio", "Procurar atualizações ao iniciar"],
  ["UPDATE AVAILABLE", "UPDATE VERFÜGBAR", "ACTUALIZACIÓN DISPONIBLE", "MISE À JOUR DISPONIBLE", "AGGIORNAMENTO DISPONIBILE", "ATUALIZAÇÃO DISPONÍVEL"],
  ["Install Update", "Update installieren", "Instalar actualización", "Installer la mise à jour", "Installa aggiornamento", "Instalar atualização"],
  ["What's New", "Neuigkeiten", "Novedades", "Nouveautés", "Novità", "Novidades"],
  ["TMDB Read Access Token", "TMDB-Lesezugriffstoken", "Token de lectura de TMDB", "Jeton de lecture TMDB", "Token di lettura TMDB", "Token de leitura do TMDB"],
  ["Change API Token", "API-Token ändern", "Cambiar token de API", "Changer le jeton API", "Cambia token API", "Alterar token da API"],
  ["Update Token", "Token aktualisieren", "Actualizar token", "Mettre à jour le jeton", "Aggiorna token", "Atualizar token"],
  ["Notify about new episodes on startup", "Beim Start über neue Folgen informieren", "Avisar de episodios nuevos al iniciar", "Signaler les nouveaux épisodes au démarrage", "Avvisa dei nuovi episodi all'avvio", "Avisar sobre novos episódios ao iniciar"],
  ["Notify when a download completes", "Benachrichtigen, wenn ein Download fertig ist", "Avisar al terminar una descarga", "Prévenir à la fin d'un téléchargement", "Avvisa al termine di un download", "Avisar quando um download terminar"],
  ["New episodes available", "Neue Folgen verfügbar", "Nuevos episodios disponibles", "Nouveaux épisodes disponibles", "Nuovi episodi disponibili", "Novos episódios disponíveis"],
  ["Clear Cache", "Cache leeren", "Borrar caché", "Vider le cache", "Svuota cache", "Limpar cache"],
  ["Clear Watch Progress", "Fortschritt löschen", "Borrar progreso", "Effacer la progression", "Cancella progressi", "Limpar progresso"],
  ["Delete All Downloads", "Alle Downloads löschen", "Eliminar todas las descargas", "Supprimer tous les téléchargements", "Elimina tutti i download", "Excluir todos os downloads"],
  ["Reset App", "App zurücksetzen", "Restablecer la app", "Réinitialiser l'app", "Reimposta app", "Redefinir o app"],
  ["This action cannot be undone.", "Das kann nicht rückgängig gemacht werden.", "Esta acción no se puede deshacer.", "Cette action est irréversible.", "Questa azione non può essere annullata.", "Esta ação não pode ser desfeita."],
  ["Something went wrong", "Etwas ist schiefgelaufen", "Algo salió mal", "Un problème est survenu", "Qualcosa è andato storto", "Algo deu errado"],
  ["Reload App", "App neu laden", "Recargar la app", "Recharger l'app", "Ricarica app", "Recarregar o app"],
  ["Open in Browser", "Im Browser öffnen", "Abrir en el navegador", "Ouvrir dans le navigateur", "Apri nel browser", "Abrir no navegador"],
  ["Open in browser", "Im Browser öffnen", "Abrir en el navegador", "Ouvrir dans le navigateur", "Apri nel browser", "Abrir no navegador"],
  ["Who's watching?", "Wer schaut gerade?", "¿Quién está viendo?", "Qui regarde ?", "Chi guarda?", "Quem está assistindo?"],
  ["Manage profiles", "Profile verwalten", "Gestionar perfiles", "Gérer les profils", "Gestisci profili", "Gerenciar perfis"],
  ["+ Add profile", "+ Profil hinzufügen", "+ Añadir perfil", "+ Ajouter un profil", "+ Aggiungi profilo", "+ Adicionar perfil"],
  ["Add profile", "Profil hinzufügen", "Añadir perfil", "Ajouter un profil", "Aggiungi profilo", "Adicionar perfil"],
  ["Watching now", "Schaut gerade", "Viendo ahora", "Regarde en ce moment", "Sta guardando", "Assistindo agora"],
  ["Tap Switch to use this profile", "Tippe auf Wechseln, um dieses Profil zu nutzen", "Toca Cambiar para usar este perfil", "Touchez Changer pour utiliser ce profil", "Tocca Cambia per usare questo profilo", "Toque em Trocar para usar este perfil"],
];

// patterns: [regex on English, (match, lang) => text]
const P = [
  [/^Because you watched (.+)$/, (m, i) => [`Weil du ${m[1]} gesehen hast`, `Porque viste ${m[1]}`, `Parce que vous avez regardé ${m[1]}`, `Perché hai guardato ${m[1]}`, `Porque você assistiu ${m[1]}`][i]],
  [/^Download season (\d+)$/, (m, i) => [`Staffel ${m[1]} herunterladen`, `Descargar temporada ${m[1]}`, `Télécharger la saison ${m[1]}`, `Scarica stagione ${m[1]}`, `Baixar temporada ${m[1]}`][i]],
  [/^Season (\d+)$/, (m, i) => [`Staffel ${m[1]}`, `Temporada ${m[1]}`, `Saison ${m[1]}`, `Stagione ${m[1]}`, `Temporada ${m[1]}`][i]],
  [/^In (\d+) lists?$/, (m, i) => [`In ${m[1]} Liste${m[1] === "1" ? "" : "n"}`, `En ${m[1]} lista${m[1] === "1" ? "" : "s"}`, `Dans ${m[1]} liste${m[1] === "1" ? "" : "s"}`, `In ${m[1]} list${m[1] === "1" ? "a" : "e"}`, `Em ${m[1]} lista${m[1] === "1" ? "" : "s"}`][i]],
  [/^(\d+) titles?$/, (m, i) => [`${m[1]} Titel`, `${m[1]} título${m[1] === "1" ? "" : "s"}`, `${m[1]} titre${m[1] === "1" ? "" : "s"}`, `${m[1]} titol${m[1] === "1" ? "o" : "i"}`, `${m[1]} título${m[1] === "1" ? "" : "s"}`][i]],
  [/^in (\d+) days$/, (m, i) => [`in ${m[1]} Tagen`, `en ${m[1]} días`, `dans ${m[1]} jours`, `tra ${m[1]} giorni`, `em ${m[1]} dias`][i]],
  [/^Your (\d{4}) in Streambert$/, (m, i) => [`Dein Jahr ${m[1]} in Streambert`, `Tu ${m[1]} en Streambert`, `Votre année ${m[1]} sur Streambert`, `Il tuo ${m[1]} su Streambert`, `Seu ${m[1]} no Streambert`][i]],
  [/^Watchlist \((\d+)\)$/, (m, i) => [`Merkliste (${m[1]})`, `Mi lista (${m[1]})`, `Ma liste (${m[1]})`, `La mia lista (${m[1]})`, `Minha lista (${m[1]})`][i]],
  [/^My Lists \((\d+)\)$/, (m, i) => [`Meine Listen (${m[1]})`, `Mis listas (${m[1]})`, `Mes listes (${m[1]})`, `Le mie liste (${m[1]})`, `Minhas listas (${m[1]})`][i]],
  [/^(Auto-download · )?Season (\d+): getting episode (\d+) \((\d+)\/(\d+)\)…$/, (m, i) => {
    const a = m[1] ? ["Auto-Download · ", "Descarga automática · ", "Téléchargement auto · ", "Download automatico · ", "Download automático · "][i] : "";
    return a + [`Staffel ${m[2]}: Folge ${m[3]} wird geholt (${m[4]}/${m[5]})…`, `Temporada ${m[2]}: obteniendo episodio ${m[3]} (${m[4]}/${m[5]})…`, `Saison ${m[2]} : récupération de l'épisode ${m[3]} (${m[4]}/${m[5]})…`, `Stagione ${m[2]}: recupero episodio ${m[3]} (${m[4]}/${m[5]})…`, `Temporada ${m[2]}: buscando episódio ${m[3]} (${m[4]}/${m[5]})…`][i];
  }],
  [/^(\d+) episodes? added to Downloads$/, (m, i) => [`${m[1]} Folge${m[1] === "1" ? "" : "n"} zu Downloads hinzugefügt`, `${m[1]} episodio${m[1] === "1" ? "" : "s"} añadido${m[1] === "1" ? "" : "s"} a Descargas`, `${m[1]} épisode${m[1] === "1" ? "" : "s"} ajouté${m[1] === "1" ? "" : "s"} aux téléchargements`, `${m[1]} episodi${m[1] === "1" ? "o aggiunto" : " aggiunti"} ai download`, `${m[1]} episódio${m[1] === "1" ? "" : "s"} adicionado${m[1] === "1" ? "" : "s"} aos downloads`][i]],
  [/^couldn't get E([\d, E]+) \(try another source\)$/, (m, i) => [`E${m[1]} nicht gefunden (andere Quelle probieren)`, `No se pudo obtener E${m[1]} (prueba otra fuente)`, `Impossible d'obtenir E${m[1]} (essayez une autre source)`, `Impossibile ottenere E${m[1]} (prova un'altra fonte)`, `Não foi possível obter E${m[1]} (tente outra fonte)`][i]],
  [/^New episode today: (.+)$/, (m, i) => [`Neue Folge heute: ${m[1]}`, `Nuevo episodio hoy: ${m[1]}`, `Nouvel épisode aujourd'hui : ${m[1]}`, `Nuovo episodio oggi: ${m[1]}`, `Novo episódio hoje: ${m[1]}`][i]],
  [/^New from (.+)$/, (m, i) => [`Neu von ${m[1]}`, `Novedad de ${m[1]}`, `Nouveau avec ${m[1]}`, `Novità con ${m[1]}`, `Novidade com ${m[1]}`][i]],
  [/^(.+) and (\d+) more$/, (m, i) => [`${m[1]} und ${m[2]} weitere`, `${m[1]} y ${m[2]} más`, `${m[1]} et ${m[2]} autres`, `${m[1]} e altri ${m[2]}`, `${m[1]} e mais ${m[2]}`][i]],
  [/^You'll be told when (.+) is in something new\.$/, (m, i) => [`Du erfährst, wenn ${m[1]} in etwas Neuem dabei ist.`, `Te avisaremos cuando ${m[1]} esté en algo nuevo.`, `Vous serez prévenu quand ${m[1]} sera dans quelque chose de nouveau.`, `Ti avviseremo quando ${m[1]} sarà in qualcosa di nuovo.`, `Você será avisado quando ${m[1]} estiver em algo novo.`][i]],
  [/^watched across (\d+) titles$/, (m, i) => [`aus ${m[1]} Titeln`, `en ${m[1]} títulos`, `sur ${m[1]} titres`, `su ${m[1]} titoli`, `em ${m[1]} títulos`][i]],
  [/^Party · (\d+)$/, (m, i) => [`Party · ${m[1]}`, `Sala · ${m[1]}`, `Soirée · ${m[1]}`, `Party · ${m[1]}`, `Sala · ${m[1]}`][i]],
  [/^Paused · (\d+)%$/, (m, i) => [`Pausiert · ${m[1]} %`, `En pausa · ${m[1]} %`, `En pause · ${m[1]} %`, `In pausa · ${m[1]}%`, `Pausado · ${m[1]}%`][i]],
];

// ── language selection ──────────────────────────────────────────────────────
export function languageSetting() {
  try {
    return JSON.parse(localStorage.getItem(SETTING) || '"system"') || "system";
  } catch {
    return "system";
  }
}
export function setLanguageSetting(v) {
  try {
    localStorage.setItem(SETTING, JSON.stringify(v || "system"));
  } catch {}
}
export function systemLanguage() {
  const l = String(navigator.language || "en").slice(0, 2).toLowerCase();
  return ORDER.includes(l) ? l : "en";
}
export function currentLanguage() {
  const s = languageSetting();
  return s !== "system" && (s === "en" || ORDER.includes(s)) ? s : systemLanguage();
}
/** translate one English UI string (for code that builds text itself) */
export function t(en) {
  const i = ORDER.indexOf(currentLanguage());
  if (i < 0) return en;
  return lookup(en, i) ?? en;
}

let MAP = null;
function lookup(s, i) {
  if (!MAP) {
    MAP = new Map();
    for (const row of T) MAP.set(row[0], row.slice(1));
  }
  const hit = MAP.get(s);
  if (hit) return hit[i];
  for (const [rx, fn] of P) {
    const m = s.match(rx);
    if (m) return fn(m, i);
  }
  return null;
}

// containers whose text is data (titles, names, overviews), never UI
const SKIP = "script,style,textarea,input,code,pre,[contenteditable],[data-no-i18n],.detail-title,.hero-title,.hero-overview,.card-title,.media-card-title,.carousel-title-text,.sbu-name,.sbx-list-name,.sbx-recap-title,.saved-thumb,.overview,.detail-overview,.episode-title,.ep-card__title,.search-result-title,.dl-card__name,.cast-name,.person-name";

function translateTree(rootNode, i) {
  const walker = document.createTreeWalker(rootNode, NodeFilter.SHOW_TEXT);
  const todo = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) todo.push(n);
  for (const n of todo) translateText(n, i);
  if (rootNode.querySelectorAll) {
    rootNode.querySelectorAll("[placeholder],[title],[aria-label]").forEach((el) => translateAttrs(el, i));
    if (rootNode.matches?.("[placeholder],[title],[aria-label]")) translateAttrs(rootNode, i);
  }
}
function translateText(n, i) {
  const v = n.nodeValue;
  if (!v || !/[A-Za-z]/.test(v)) return;
  const p = n.parentElement;
  if (!p || p.closest(SKIP)) return;
  const trimmed = v.trim();
  const tr = lookup(trimmed, i);
  if (tr != null && tr !== trimmed) n.nodeValue = v.replace(trimmed, tr);
}
function translateAttrs(el, i) {
  if (el.closest(SKIP) && !el.matches("input,textarea")) return;
  for (const a of ["placeholder", "title", "aria-label"]) {
    const v = el.getAttribute(a);
    if (!v) continue;
    const tr = lookup(v.trim(), i);
    if (tr != null && tr !== v) el.setAttribute(a, tr);
  }
}

/** Start translating the UI (no-op for English). Call once at startup. */
export function initI18n() {
  const lang = currentLanguage();
  document.documentElement.lang = lang;
  // the TMDB metadata language follows the app language until it's set by hand
  try {
    if (!localStorage.getItem("streambert_tmdbLang")) {
      const L = LANGUAGES.find((x) => x.code === lang);
      if (L && L.code !== "en") localStorage.setItem("streambert_tmdbLang", JSON.stringify(L.tmdb));
    }
  } catch {}
  const i = ORDER.indexOf(lang);
  if (i < 0) return;
  const run = () => {
    translateTree(document.body, i);
    new MutationObserver((muts) => {
      for (const m of muts) {
        if (m.type === "characterData") translateText(m.target, i);
        else if (m.type === "attributes") translateAttrs(m.target, i);
        else
          for (const n of m.addedNodes) {
            if (n.nodeType === 3) translateText(n, i);
            else if (n.nodeType === 1) translateTree(n, i);
          }
      }
    }).observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["placeholder", "title", "aria-label"],
    });
  };
  if (document.body) run();
  else document.addEventListener("DOMContentLoaded", run, { once: true });
}
