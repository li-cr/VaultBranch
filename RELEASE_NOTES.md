VaultBranch 0.2.26 restores the top padding of the first settings card.

- Remove the plugin CSS rule that forced the first setting item in each tab to zero top padding. Let native Obsidian and theme card spacing apply consistently to all items.
- Keep setting labels, saved values and behavior unchanged. The runtime change deletes one CSS rule; no JavaScript or dependencies are added.

Verified in the note_test vault with the user's Things theme stylesheet: first and second cards both have 16 px top padding in General, Git, Commit and Other. Saved preferences remain unchanged and no runtime errors were captured. Syntax, version, CSS and build checks pass. Generated main.js is byte-identical to 0.2.25. No performance improvement is claimed.

Release assets retain GitHub provenance attestations. Desktop only; requires Git installed separately.
