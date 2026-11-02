<?php
// Elenco dinamico delle missioni: ogni sottocartella di /missions con un mission.json
// (le cartelle che iniziano con "_" o "." sono ignorate). Compatibile con l'hosting Aruba (PHP).
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
$base = __DIR__ . '/missions';
$out = [];
if (is_dir($base)) {
    foreach (scandir($base) as $d) {
        if ($d[0] === '.' || $d[0] === '_') continue;
        if (is_file("$base/$d/mission.json")) $out[] = ['folder' => $d, 'id' => $d];
    }
}
echo json_encode(['missions' => $out], JSON_UNESCAPED_UNICODE);
