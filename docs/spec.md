# TCGStudio — Product Specification

The authoritative spec is currently maintained in the project instructions
(Claude project context). When the spec stabilizes it will be mirrored here in
versioned form, broken into one file per major section so PRs can reference
specific clauses.

For now, see the project context for the full text. The headline:

> TCGStudio is a multi-tenant, white-label creation and publishing suite for
> building custom card games, managing their data, designing their cards,
> validating their rules, publishing their public websites, and exporting
> production-ready assets.

## Section index (high level)

1. Product identity
2. Vision and goals
3. Target users (solo creators, indie studios, publishers, schools, resellers, devs)
4. Platform model (platform → tenant → brand → org → team → project)
5. Multi-tenancy
6. White-labeling
7. Authentication and RBAC
8. Built-in CMS
9. Public card gallery
10. Project / card type / card data systems
11. Card Type Designer (canvas, layers, zones)
12. Asset, variant, schema systems
13. Rules / abilities / keywords
14. Board and zone designer
15. Sets and packs
16. Lore and playtest systems
17. Import / export / validation
18. Plugin and marketplace systems
19. APIs (REST, GraphQL, WebSockets)
20. Background jobs, search, cache, audit logs
21. Billing, storage, database, deployment
22. Self-hosted enterprise
23. MVP scope and roadmap
