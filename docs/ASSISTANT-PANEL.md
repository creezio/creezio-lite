# Disposition du panneau assistant

La décision appartient à AssistantProvider et sert au shell et au widget. Elle ne dépend ni d'une marque ni d'un rôle métier.

- Viewport inférieur à 768 pixels CSS : plein écran.
- Sinon : panneau latéral de 400px seulement si largeur du shell − marge effective de la sidebar − 400px ≥ 640px.
- Sinon : superposition à droite, 400px au maximum et jamais plus large que le viewport.

Le seuil de contenu est configurable par la prop facultative minMainWidth d'AssistantProvider (640px par défaut). La largeur du shell est mesurée avec clientWidth, avant tout retrait du panneau ; la sidebar vient de la marge réellement appliquée au contenu. ResizeObserver, resize et changement de sidebar actualisent la mesure. Le padding droit n'est présent qu'en mode docked ouvert et hydraté. La largeur de viewport sert au breakpoint mobile ; la scrollbar est prise en compte dans la place restante.

À 768/1024px avec sidebar256px, le panneau est superposé. À1440px il est docké. À1200px, réduire la sidebar de256 à64px rend le docking possible. À200% de zoom, les mêmes règles utilisent les pixels CSS disponibles.

Les modes superposé/plein écran utilisent Dialog Radix existant : fond, focus modal, verrouillage du scroll, menus et dialogues imbriqués, Escape et fermeture explicite. Le mode docké reste complémentaire : cliquer dans l'application ne le ferme pas. Une fermeture utilisateur rend le focus au FAB. Le menu mobile est refermé à l'ouverture de l'assistant, sans reprendre le focus derrière lui. Le mode chatOnly reste plein écran et ne devient pas une modale fermable.

La présentation n'est pas persistée. L'état conversation/modèle/messages/saisie reste dans AssistantWidget ; changer la présentation ne change ni le transport ni la session. Aucun contenu applicatif privé n'est requis pour les tests.

Validation automatisée : tests/assistant-panel.test.mjs couvre seuils, sidebar, scrollbar, conteneur étroit, configuration, resize, conversation et saisie persistantes. La recette navigateur doit aussi contrôler Tab/Shift+Tab, Escape, menus imbriqués, retour au FAB, clavier mobile, zoom et modes 320/390/768/1024/1440 sur le SHA intégré.

Au changement entre docké et modal, Radix reconstruit sa surface. Un snapshot avant mutation restaure le champ actif et sa sélection, seulement si le focus était dans une saisie de l'assistant. L'autofocus modal ne remplace pas ce focus restauré. Les sous-composants visuels et leur position de scroll peuvent encore être remontés ; la conversation et les saisies contrôlées du widget sont conservées.
