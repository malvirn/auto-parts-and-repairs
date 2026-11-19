# Centric Auto Mobile document templates

Open any HTML file in a modern browser. The templates use plain HTML, CSS and vanilla JavaScript.

## Rebrand
Edit the SHOP object at the top of app.js to change shop name, subtitle, slogan, contact details, currency and default VAT rate. Edit the CSS variables at the top of shared.css to change accent colour, typography and layout styling. Replace the text-based logo area in the header renderer in app.js with an image element to use your logo.

## Data and calculations
Edit the docs object in app.js to change the sample invoice, receipt, credit note and job card data. Form fields are editable in the browser. VAT defaults to 15.5%. Line totals, VAT, totals and receipt balance are calculated from the document data.

## Printing
Use Print / Save as PDF. Select A4 portrait and enable background graphics. The toolbar is hidden in print.

## Linking
The receipt and credit note contain invoice references. The job card's Convert job card to invoice button transfers its customer, vehicle, parts and labour estimate into the invoice template. The transfer uses local storage in the current browser.

These are client-side templates, not a production transaction store or a fiscalisation integration. Confirm statutory tax and fiscal requirements before issuing official invoices.
