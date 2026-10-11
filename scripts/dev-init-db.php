<?php
declare(strict_types=1);

// Executed only by the isolated dev PHP runner; no credentials in arguments/logs.
if (getcwd() !== '/workspace' || !is_file('.dev-private/root-password')) {
    throw new RuntimeException('Dev workspace required.');
}
$password = trim(file_get_contents('.dev-private/smoke-password'));
if (!preg_match('/^[a-f0-9]{64}$/', $password)) {
    throw new RuntimeException('Invalid generated dev password.');
}
$pdo = new PDO('mysql:host=db;port=3306;charset=utf8mb4', 'root', trim(file_get_contents('.dev-private/root-password')), [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$pdo->exec('CREATE DATABASE IF NOT EXISTS inkgroove_check CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
$pdo->exec("CREATE USER IF NOT EXISTS 'inkgroove_check'@'%' IDENTIFIED BY " . $pdo->quote($password));
$pdo->exec("GRANT ALL PRIVILEGES ON inkgroove_check.* TO 'inkgroove_check'@'%'");
foreach (['inkgroove_dev' => 'inkgroove_check', 'inkgroove_check' => 'inkgroove_dev'] as $user => $otherDatabase) {
    $file = $user === 'inkgroove_dev' ? 'app-password' : 'smoke-password';
    try {
        new PDO('mysql:host=db;port=3306;dbname='.$otherDatabase, $user, trim(file_get_contents('.dev-private/'.$file)));
        throw new RuntimeException('Dev database permissions are not isolated.');
    } catch (PDOException $exception) {
        if (($exception->errorInfo[1] ?? null) !== 1044) {
            throw new RuntimeException('Could not verify dev database isolation.');
        }
    }
}
echo "Independent check database ready; cross-database access denied for both users.\n";
